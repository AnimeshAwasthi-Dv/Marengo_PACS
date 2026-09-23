import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { scopedShareToken, verifyShareScope } from './shareScope';

export const PHYSICIAN_REPORT_READY = 'PHYSICIAN_REPORT_READY';
export const PHYSICIAN_CALL_REQUESTED = 'PHYSICIAN_CALL_REQUESTED';
export const PHYSICIAN_ROLE = 'REFERRING_PHYSICIAN';

export function physicianNameKey(name: string) {
  return name.split('=')[0].normalize('NFKC').toLowerCase().replace(/\b(?:dr|doctor|prof)\b\.?/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

type Physician = { id: string; name: string; role: string; clientId: string | null; phoneE164: string | null; active: boolean; verificationStatus: string; consentStatus: string; createdAt: Date };
export function matchingPhysician(recipients: Physician[], names: string[], clientId: string) {
  const keys = [...new Set(names.map(physicianNameKey).filter(Boolean))];
  // Conflicting metadata or duplicate configured names require an administrator to resolve them.
  if (keys.length !== 1) return null;
  const matches = recipients.filter(person => person.role === PHYSICIAN_ROLE && person.active && person.phoneE164
    && person.verificationStatus === 'VERIFIED' && ['OPTED_IN', 'APPROVED', 'ACTIVE'].includes(person.consentStatus)
    && (!person.clientId || person.clientId === clientId) && physicianNameKey(person.name) === keys[0]);
  return matches.length === 1 ? matches[0] : null;
}

function metadataPhysicians(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== 'object' || depth > 5) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (['referringphysician', 'referringphysicianname', 'referringdoctor', '00080090', 'x00080090'].includes(key.toLowerCase().replace(/[^a-z0-9]/g, '')) && typeof item === 'string') return [item];
    return typeof item === 'object' ? metadataPhysicians(item, depth + 1) : [];
  });
}

export async function reportPhysicianNames(db: PrismaClient, report: { clientId: string; studyUid: string | null; aiReportJson: unknown; editedReportJson: unknown }) {
  const bridges = report.studyUid ? await db.availableBridgeStudy.findMany({
    where: { clientId: report.clientId, studyInstanceUid: report.studyUid }, select: { referringPhysician: true },
  }) : [];
  return [...bridges.map(study => study.referringPhysician ?? ''), ...metadataPhysicians(report.editedReportJson), ...metadataPhysicians(report.aiReportJson)].filter(Boolean);
}

export function reportReadyTemplate(to: string, url: string, outboxId: string, name: string, language: string) {
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/^\+/, ''), type: 'template',
    template: { name, language: { code: language }, components: [
      { type: 'body', parameters: [{ type: 'text', text: url }] },
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `physician_call:${outboxId}` }] },
    ] },
  };
}

export function physicianWhatsappReady(env: NodeJS.ProcessEnv = process.env) {
  return env.WHATSAPP_CLOUD_API_ENABLED === 'true' && ['WHATSAPP_CLOUD_API_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_REPORT_READY_TEMPLATE_NAME', 'PORTAL_BASE_URL'].every(key => Boolean(env[key]?.trim()));
}

// Reconciliation covers every report approval path, including external provider returns.
// Existing reports from before a recipient was configured are not broadcast retroactively.
export async function enqueuePhysicianReports(db: PrismaClient) {
  const recipients = await db.notificationRecipient.findMany({ where: { role: PHYSICIAN_ROLE, active: true } });
  if (!recipients.length) return;
  const since = new Date(Math.min(...recipients.map(person => person.createdAt.getTime())));
  let cursor: string | undefined;
  for (;;) {
    const reports = await db.reportReview.findMany({
      where: { status: { in: ['APPROVED', 'PUSHED'] }, OR: [{ approvedAt: { gte: since } }, { approvedAt: null, createdAt: { gte: since } }] },
      orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const report of reports) {
      const recipient = matchingPhysician(recipients, await reportPhysicianNames(db, report), report.clientId);
      if (!recipient || (report.approvedAt ?? report.createdAt) < recipient.createdAt) continue;
      const idempotencyKey = `physician-report:${report.id}`;
      if (await db.notificationOutbox.findUnique({ where: { idempotencyKey }, select: { id: true } })) continue;
      await db.$transaction(async tx => {
        const existing = await tx.reportPublicShare.findUnique({ where: { reportId: report.id } });
        // Respect expired/revoked existing links rather than silently re-enabling access.
        if (existing && existing.expiresAt <= new Date()) return;
        const share = existing ?? await tx.reportPublicShare.upsert({
          where: { reportId: report.id }, update: {},
          create: { reportId: report.id, token: crypto.randomBytes(32).toString('base64url'), expiresAt: new Date(Date.now() + 5 * 86400_000) },
        });
        const token = scopedShareToken(report.id, share.token, false);
        await tx.notificationOutbox.upsert({
          where: { idempotencyKey }, update: {}, create: {
            eventType: PHYSICIAN_REPORT_READY, aggregateType: 'ReportReview', aggregateId: report.id, idempotencyKey,
            payload: { category: 'PHYSICIAN_REPORT', reportId: report.id, clientId: report.clientId, recipientId: recipient.id,
              to: [recipient.phoneE164!], shareToken: token,
              message: 'Your referred study report is ready. Open the report link or request a radiologist call.' },
          },
        });
      });
    }
    if (reports.length < 100) break;
    cursor = reports.at(-1)!.id;
  }
}

export async function physicianDelivery(db: PrismaClient, payload: unknown) {
  const data = payload as { recipientId?: string; reportId?: string; to?: string[]; shareToken?: string };
  if (!data?.recipientId || !data.reportId || !data.shareToken) return null;
  const [recipient, report, share] = await Promise.all([
    db.notificationRecipient.findUnique({ where: { id: data.recipientId } }),
    db.reportReview.findUnique({ where: { id: data.reportId }, include: { radiologist: true } }),
    db.reportPublicShare.findUnique({ where: { reportId: data.reportId } }),
  ]);
  if (!recipient || !report || !['APPROVED', 'PUSHED'].includes(report.status) || !share || share.expiresAt <= new Date()
    || !verifyShareScope(data.shareToken, report.id, share.token) || data.to?.length !== 1 || data.to[0] !== recipient.phoneE164) return null;
  const candidates = await db.notificationRecipient.findMany({ where: { role: PHYSICIAN_ROLE, active: true } });
  if (matchingPhysician(candidates, await reportPhysicianNames(db, report), report.clientId)?.id !== recipient.id) return null;
  return { recipient, report, url: `${process.env.PORTAL_BASE_URL!.replace(/\/+$/, '')}/shared/${encodeURIComponent(data.shareToken)}` };
}

export async function requestPhysicianCall(db: PrismaClient, from: string, outboxId: string) {
  const outbox = await db.notificationOutbox.findUnique({ where: { id: outboxId } });
  if (!outbox || outbox.eventType !== PHYSICIAN_REPORT_READY || outbox.status !== 'SENT') return false;
  const delivery = await physicianDelivery(db, outbox.payload);
  if (!delivery || delivery.recipient.phoneE164 !== from) return false;
  const { report, recipient } = delivery;
  await db.$transaction(async tx => {
    const event = await tx.notificationEvent.upsert({
      where: { idempotencyKey: `physician-call:${outboxId}` }, update: {}, create: {
        eventType: PHYSICIAN_CALL_REQUESTED, category: 'CALL_BOOKING', aggregateType: 'ReportReview', aggregateId: report.id,
        clientId: report.clientId, status: 'PENDING', title: 'Referring physician requests a call',
        message: `${recipient.name} requested a radiologist call about report ${report.id}. Callback: ${recipient.phoneE164}`,
        metadata: { recipientId: recipient.id, physicianName: recipient.name, phone: recipient.phoneE164, reportId: report.id, radiologistId: report.radiologistId },
        idempotencyKey: `physician-call:${outboxId}`,
      },
    });
    const users = await tx.user.findMany({ where: { active: true, OR: [{ role: 'SUPER_ADMIN' }, ...(report.radiologist?.userId ? [{ id: report.radiologist.userId, role: 'RADIOLOGIST' as const }] : [])] }, select: { id: true, role: true } });
    await tx.notificationDelivery.createMany({ skipDuplicates: true, data: users.map(user => ({
      eventId: event.id, clientId: report.clientId, recipientUserId: user.id, recipientOrganization: user.role === 'SUPER_ADMIN' ? 'DECTROCEL' : 'RADIOLOGIST',
      recipientKey: `user:${user.id}`, channel: 'IN_APP', status: 'DELIVERED', deliveredAt: new Date(),
    })) });
  });
  return true;
}
