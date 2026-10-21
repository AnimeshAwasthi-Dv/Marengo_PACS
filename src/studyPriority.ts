type PriorityJob = { status: string; providerJobId?: string | null; submissionRetryCount?: number };

// Lock before the worker builds the outbound request, not after the response arrives.
export function canChangeJobPriority(job: PriorityJob) {
  return job.status === 'queued' && !job.providerJobId && !(job.submissionRetryCount && job.submissionRetryCount > 0);
}

export function canChangeStudyPriority(study: {
  workflowStatus: string;
  processingJobId?: string | null;
  processingJob?: PriorityJob | null;
}) {
  const workflow = study.workflowStatus.replace(/[\s_-]/g, '').toLowerCase();
  if (/reportgenerated|reported|completed|cancelled|submitting|submitted|sentto|processing|awaiting/.test(workflow)) return false;
  if (study.processingJob) return canChangeJobPriority(study.processingJob);
  return !study.processingJobId && /^(available|receiving|ready)$/.test(workflow);
}
