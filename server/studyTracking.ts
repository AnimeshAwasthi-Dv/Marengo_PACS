import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { redactExchange, studyTatCategory, tatTargetSeconds } from './telegramPolicy';

export async function studyTracking(jobId: string, clientIds: string[] | null, db = prisma) {
  const job = await db.processingJob.findFirst({ where: { id: jobId, ...(clientIds === null ? {} : { clientId: { in: clientIds } }) }, include: {
    bridgeStudy: { select: { studyInstanceUid: true, modalities: true, submittedAt: true, studyDescription: true, patientName: true, accessionNumber: true } },
    client: { select: { name: true } },
  } });
  if (!job) return null;
  const mappings = await db.providerJobMapping.findMany({ where: { processingJobId: job.id } });
  const reportIds = mappings.flatMap(m => m.reportReviewId ? [m.reportReviewId] : []);
  const reports = await db.reportReview.findMany({ where: { clientId: job.clientId, OR: [{ id: { in: reportIds } }, ...(job.bridgeStudy ? [{ studyUid: job.bridgeStudy.studyInstanceUid }] : [])] }, orderBy: { generatedAt: 'desc' }, take: 1 });
  const report = reports[0];
  const finalized = report && ['APPROVED', 'PUSHED'].includes(report.status);
  const completedAt = finalized ? (report.approvedAt ?? report.pushedAt ?? report.generatedAt).toISOString() : null;
  const modality = job.bridgeStudy?.modalities[0] ?? report?.modality ?? job.serviceType;
  const startedAt = (job.bridgeStudy?.submittedAt ?? job.createdAt).toISOString();
  const event = await db.notificationOutbox.findUnique({ where: { idempotencyKey: `telegram:processing:${job.id}` } });
  const payload = event?.payload as Record<string, unknown> | undefined;
  const tatCategory = typeof payload?.tatCategory === 'string' ? payload.tatCategory : studyTatCategory(modality, job.serviceType, job.bridgeStudy?.studyDescription);
  // Active countdowns follow corrected SLAs and current priority; completed reports retain their snapshot.
  const targetSeconds = finalized && payload && 'targetSeconds' in payload ? (typeof payload.targetSeconds === 'number' ? payload.targetSeconds : null) : tatTargetSeconds(tatCategory, job.priority);
  const dectrocelIds = mappings.map(m => m.dectrocelJobId);
  const requests = dectrocelIds.length ? await db.providerApiRequest.findMany({ where: { OR: dectrocelIds.flatMap(id => [
    { metadata: { path: ['dectrocelJobId'], equals: id } }, { metadata: { path: ['dectrocel_job_id'], equals: id } },
  ]) }, orderBy: { createdAt: 'desc' }, take: 50 }) : [];
  const acknowledgements = await db.jobStatusHistory.findMany({ where: { processingJobId: job.id, sourceSystem: { in: ['RENEWIST_EXCHANGE', 'BRIDGE_EXCHANGE'] } }, orderBy: { createdAt: 'desc' }, take: 50 });
  return {
    id: job.id, center: job.client.name, patientName: job.bridgeStudy?.patientName ?? report?.patientName ?? null,
    accession: job.bridgeStudy?.accessionNumber ?? report?.accession ?? null,
    modality, priority: job.priority === 'URGENT' ? 'Urgent' : 'Routine',
    status: finalized ? 'Reported' : /fail|error|cancel/i.test(job.status) ? 'Needs attention' : 'Reporting',
    processingStatus: job.status, startedAt, completedAt, targetSeconds, tatCategory,
    dueAt: targetSeconds === null ? null : new Date(Date.parse(startedAt) + targetSeconds * 1000).toISOString(),
    serverTime: new Date().toISOString(),
    notification: event ? { status: event.status, attempts: event.attempts, sentAt: event.processedAt?.toISOString() ?? null } : null,
    exchanges: [...requests.filter(r => r.direction === 'OUTBOUND').map(r => ({ id: r.id, direction: 'Renewist response to submission', at: r.createdAt.toISOString(), httpStatus: r.responseCode, body: redactExchange((r.metadata as Record<string, unknown>)?.response ?? { status: r.status }) })),
      ...acknowledgements.map(h => ({ id: h.id, direction: h.sourceSystem === 'BRIDGE_EXCHANGE' ? 'Portal response to incoming bridge study' : 'Portal response to Renewist callback', at: h.createdAt.toISOString(), httpStatus: null, body: redactExchange(h.technicalDetails) }))].sort((a, b) => b.at.localeCompare(a.at)),
  };
}

export async function recordStudyAcknowledgement(jobId: string, source: 'RENEWIST_EXCHANGE' | 'BRIDGE_EXCHANGE', body: unknown) {
  await prisma.jobStatusHistory.create({ data: { processingJobId: jobId, sourceSystem: source, newStatus: 'ACKNOWLEDGED', technicalDetails: redactExchange(body) as Prisma.InputJsonObject } });
}
