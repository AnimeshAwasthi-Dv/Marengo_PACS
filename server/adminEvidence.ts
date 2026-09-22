import { createHash } from 'node:crypto';
import { prisma } from './db';
import { redactExchange } from './telegramPolicy';

export const adminStatuses = ['Available', 'Reporting', 'Reported', 'Needs attention', 'Cancelled'] as const;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function evidenceHash(value: unknown) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }

export async function correctStudyStatus(id: string, input: { status: string; reason: string; expectedUpdatedAt: string }, actor: string, ip: string | undefined, db = prisma) {
  if (!adminStatuses.includes(input.status as typeof adminStatuses[number]) || input.reason.trim().length < 10 || input.reason.length > 2000 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw Object.assign(new Error('Select a valid status and provide a reason of 10-2000 characters.'), { status: 400 });
  return db.$transaction(async tx => {
    const study = await tx.availableBridgeStudy.findUnique({ where: { id }, include: { processingJob: true } });
    if (!study) throw Object.assign(new Error('Study not found.'), { status: 404 });
    if (study.updatedAt.toISOString() !== input.expectedUpdatedAt) throw Object.assign(new Error('Study changed. Reload its details before correcting status.'), { status: 409 });
    const report = await tx.reportReview.findFirst({ where: { clientId: study.clientId, studyUid: study.studyInstanceUid, status: { in: ['APPROVED', 'PUSHED'] } }, select: { id: true } });
    if (input.status === 'Reported' && !report) throw Object.assign(new Error('A finalized report is required. A status correction cannot create a signed report.'), { status: 409 });
    if (report && input.status !== 'Reported') throw Object.assign(new Error('This study has a finalized report. Use the report amendment/revocation workflow first.'), { status: 409 });
    if (input.status === 'Available' && study.processingJob) throw Object.assign(new Error('An existing processing job cannot be made available for duplicate submission. Use Reporting or Needs attention.'), { status: 409 });
    if (input.status === 'Reporting' && !study.processingJob) throw Object.assign(new Error('Send this study for reporting first. A status correction cannot submit it to Renewist.'), { status: 409 });
    const workflowStatus = { Available: 'Available', Reporting: 'Processing', Reported: 'Reported', 'Needs attention': 'Failed', Cancelled: 'Cancelled' }[input.status]!;
    const before = { workflowStatus: study.workflowStatus, jobStatus: study.processingJob?.status ?? null };
    const jobStatus = { Reporting: 'processing', Reported: 'completed', 'Needs attention': 'failed', Cancelled: 'cancelled' }[input.status];
    await tx.availableBridgeStudy.update({ where: { id }, data: { workflowStatus } });
    if (study.processingJob && jobStatus) await tx.processingJob.update({ where: { id: study.processingJob.id }, data: { status: jobStatus } });
    const details = { studyId: id, processingJobId: study.processingJobId, before, after: { workflowStatus, jobStatus: study.processingJob ? jobStatus : null }, reason: input.reason.trim(), providerUpdated: false };
    await tx.auditLog.create({ data: { clientId: study.clientId, actorUserId: actor, ipAddress: ip, action: 'ADMIN_STUDY_STATUS_CORRECTED', metadata: details } });
    await tx.jobStatusHistory.create({ data: { processingJobId: study.processingJobId, actorUserId: actor, sourceSystem: 'SUPER_ADMIN', previousStatus: study.workflowStatus, newStatus: workflowStatus, reason: input.reason.trim(), technicalDetails: details } });
    return { message: 'Portal status corrected and audited. No request was sent to Renewist and no report was created.' };
  }, { isolationLevel: 'Serializable' });
}

export function evidenceRecord(input: { id: string; source: string; at: Date; action: string; actorId?: string | null; centerId?: string | null; requestId?: string | null; httpStatus?: number | null; storedHash?: string | null; details: unknown }) {
  const row = JSON.parse(JSON.stringify({ ...input, at: input.at.toISOString(), details: redactExchange(input.details) })) as Omit<typeof input, 'at'> & { at: string };
  return { ...row, exportSha256: evidenceHash(row) };
}
