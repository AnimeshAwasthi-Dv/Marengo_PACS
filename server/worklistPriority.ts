import { enqueueTelegramStudy, TELEGRAM_URGENT_EVENT } from './telegram';
import { telegramUrgentConfig } from './telegramPolicy';
import { prisma } from './db';
import { canChangeJobPriority, canChangeStudyPriority } from '../src/studyPriority';

const priorityLocked = () => Object.assign(new Error('Priority cannot be changed once submission to Renewist has started.'), { status: 409 });
const editableJob = { status: 'queued', providerJobId: null, submissionRetryCount: 0 };

export async function markWorklistUrgent(studyId: string, clientIds: string[] | null, actorUserId: string, db = prisma) {
  return setWorklistPriority(studyId, clientIds, actorUserId, 'URGENT', db);
}

export async function setWorklistPriority(studyId: string, clientIds: string[] | null, actorUserId: string, priority: 'URGENT' | 'REGULAR', db = prisma) {
  if (!['URGENT', 'REGULAR'].includes(priority)) throw Object.assign(new Error('Invalid study priority.'), { status: 400 });
  const label = priority === 'URGENT' ? 'Urgent' : 'Routine';
  return db.$transaction(async tx => {
    const study = await tx.availableBridgeStudy.findFirst({ where: { id: studyId, ...(clientIds === null ? {} : { clientId: { in: clientIds } }) }, include: { processingJob: true } });
    if (!study) throw Object.assign(new Error('Study not found for your center.'), { status: 404 });
    if (!canChangeStudyPriority(study)) throw priorityLocked();
    const finalReport = await tx.reportReview.findFirst({ where: { clientId: study.clientId, studyUid: study.studyInstanceUid, status: { in: ['APPROVED', 'PUSHED'] } }, select: { id: true } });
    if (finalReport) throw Object.assign(new Error('Priority cannot be changed after reporting is complete.'), { status: 409 });
    const job = study.processingJob;
    // A failed/accepted submission can have been requeued; never change its original priority.
    if (job && await tx.providerJobMapping.findFirst({ where: { processingJobId: job.id }, select: { id: true } })) throw priorityLocked();
    const previousPriority = job?.priority ?? study.priority;
    if (previousPriority !== priority || study.priority !== priority) {
      if (job) {
        // Compete atomically with the worker's queued -> submitting_to_renewist claim.
        const updated = await tx.processingJob.updateMany({ where: { id: job.id, ...editableJob }, data: { priority } });
        if (!updated.count) throw priorityLocked();
      }
      const updatedStudy = await tx.availableBridgeStudy.updateMany({ where: { id: study.id, processingJobId: job?.id ?? null }, data: { priority } });
      if (!updatedStudy.count) throw priorityLocked();
      const telegram = telegramUrgentConfig();
      if (job && priority === 'URGENT' && telegram.enabled) await enqueueTelegramStudy(tx, { ...job, priority }, study.modalities?.[0], telegram, study.studyDescription, TELEGRAM_URGENT_EVENT, job.id + ':marked-urgent');
      await tx.auditLog.create({ data: { clientId: study.clientId, actorUserId, action: priority === 'URGENT' ? 'STUDY_MARKED_URGENT' : 'STUDY_MARKED_ROUTINE', metadata: { studyId: study.id, processingJobId: job?.id ?? null, previousPriority, priority, source: 'WORKLIST' } } });
    }
    return { studyId: study.id, priority, requiresProviderFollowUp: false, message: `Study priority marked ${label}.` };
  }, { isolationLevel: 'Serializable' });
}

export async function markProcessingJobUrgent(jobId: string, clientId: string, actorUserId: string, db = prisma) {
  if (!clientId) throw Object.assign(new Error('A center account is required.'), { status: 403 });
  return db.$transaction(async tx => {
    const job = await tx.processingJob.findFirst({ where: { id: jobId, clientId } });
    if (!job) throw Object.assign(new Error('Study not found for your center.'), { status: 404 });
    if (!canChangeJobPriority(job)) throw priorityLocked();
    if (await tx.providerJobMapping.findFirst({ where: { processingJobId: job.id }, select: { id: true } })) throw priorityLocked();
    if (Date.now() - job.createdAt.getTime() > 5 * 60 * 1000) throw Object.assign(new Error('Urgent marking is available only for 5 minutes after study submission.'), { status: 409 });
    if (job.priority === 'URGENT') return job;
    const updated = await tx.processingJob.updateMany({
      where: { id: job.id, clientId, ...editableJob },
      data: { priority: 'URGENT', upstreamStatus: {
        ...(job.upstreamStatus && typeof job.upstreamStatus === 'object' && !Array.isArray(job.upstreamStatus) ? job.upstreamStatus as Record<string, unknown> : {}),
        priority: 'URGENT', urgentMarkedAt: new Date().toISOString(),
      } },
    });
    if (!updated.count) throw priorityLocked();
    await tx.availableBridgeStudy.updateMany({ where: { processingJobId: job.id }, data: { priority: 'URGENT' } });
    await tx.auditLog.create({ data: { clientId, actorUserId, action: 'STUDY_MARKED_URGENT', metadata: { processingJobId: job.id, uploadName: job.uploadName, previousPriority: job.priority ?? 'REGULAR' } } });
    return tx.processingJob.findUniqueOrThrow({ where: { id: job.id } });
  }, { isolationLevel: 'Serializable' });
}
