export const SUBMISSION_RETRY_DELAY_MS = 3 * 60_000;
export const SUBMISSION_RETRY_LIMIT = 1;

export function submissionRetryDue(attempts: number, now = new Date()) {
  return attempts < SUBMISSION_RETRY_LIMIT ? new Date(now.getTime() + SUBMISSION_RETRY_DELAY_MS) : null;
}
