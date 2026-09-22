import { prisma } from './db';

export async function markWorklistUrgent(studyId: string, clientIds: string[] | null, actorUserId: string, db = prisma) {
  return setWorklistPriority(studyId, clientIds, actorUserId, 'URGENT', db);
}

export async function setWorklistPriority(studyId: string, clientIds: string[] | null, actorUserId: string, priority: 'URGENT' | 'REGULAR', db = prisma) {
  if (!['URGENT', 'REGULAR'].includes(priority)) throw Object.assign(new Error('Invalid study priority.'), { status: 400 });
  const label = priority === 'URGENT' ? 'Urgent' : 'Routine';
  return db.$transaction(async tx => {
    const study = await tx.availableBridgeStudy.findFirst({ where: { id: studyId, ...(clientIds === null ? {} : { clientId: { in: clientIds } }) }, include: { processingJob: true } });
    if (!study) throw Object.assign(new Error('Study not found for your center.'), { status: 404 });
    const finalReport = await tx.reportReview.findFirst({ where: { clientId: study.clientId, studyUid: study.studyInstanceUid, status: { in: ['APPROVED', 'PUSHED'] } }, select: { id: true } });
    if (finalReport || /reportgenerated|reported|completed|cancelled/i.test(study.workflowStatus) || /^(completed|sent_to_pacs|report_delivered|cancelled)$/i.test(study.processingJob?.status ?? '')) throw Object.assign(new Error('Priority cannot be changed after reporting is complete.'), { status: 409 });
    const job = study.processingJob;
    const previousPriority = job?.priority ?? study.priority;
    const requiresProviderFollowUp = Boolean(job && (job.status !== 'queued' || job.providerJobId));
    if (previousPriority !== priority || study.priority !== priority) {
      await tx.availableBridgeStudy.update({ where: { id: study.id }, data: { priority } });
      if (job) await tx.processingJob.update({ where: { id: job.id }, data: { priority } });
      await tx.auditLog.create({ data: { clientId: study.clientId, actorUserId, action: priority === 'URGENT' ? 'STUDY_MARKED_URGENT' : 'STUDY_MARKED_ROUTINE', metadata: { studyId: study.id, processingJobId: job?.id ?? null, previousPriority, priority, requiresProviderFollowUp, source: 'WORKLIST' } } });
    }
    return { studyId: study.id, priority, requiresProviderFollowUp, message: requiresProviderFollowUp
      ? `Priority marked ${label} in the portal. This study has entered processing; contact the reporting team to confirm the change. Renewist priority is not updated automatically.`
      : `Study priority marked ${label}.` };
  }, { isolationLevel: 'Serializable' });
}
