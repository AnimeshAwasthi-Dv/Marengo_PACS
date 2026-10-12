export const SUBMISSION_RETRY_DELAY_MS = 3 * 60_000;
export const SUBMISSION_RETRY_LIMIT = 1;
// The sweep only picks up recent failures, so failed jobs from before this policy are not re-sent on deploy.
export const SUBMISSION_RETRY_SWEEP_WINDOW_MS = 60 * 60_000;

export function submissionRetrySweepSince(now = new Date()) {
  return new Date(now.getTime() - SUBMISSION_RETRY_SWEEP_WINDOW_MS);
}

export function submissionRetryDue(attempts: number, now = new Date()) {
  return attempts < SUBMISSION_RETRY_LIMIT ? new Date(now.getTime() + SUBMISSION_RETRY_DELAY_MS) : null;
}
