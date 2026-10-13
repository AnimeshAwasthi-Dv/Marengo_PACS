export const SUBMISSION_RETRY_DELAY_MS = Math.max(1000, Number(process.env.SUBMISSION_RETRY_DELAY_MS ?? 3 * 60_000) || 3 * 60_000);
// Automatic retries after a failed Renewist submission. The default of one fallback was requested
// (PROCESS-GAPS-FIXES.md); SUBMISSION_RETRY_LIMIT raises it. Each retry waits twice as long: 3, 6, 12 min...
export const SUBMISSION_RETRY_LIMIT = Math.max(0, Math.min(10, Number(process.env.SUBMISSION_RETRY_LIMIT ?? 1) || 0));
// The sweep only picks up recent failures, so failed jobs from before this policy are not re-sent on deploy.
export const SUBMISSION_RETRY_SWEEP_WINDOW_MS = 60 * 60_000;

export function submissionRetrySweepSince(now = new Date()) {
  return new Date(now.getTime() - SUBMISSION_RETRY_SWEEP_WINDOW_MS);
}

/** When retry number `attempts + 1` is due, or null once the limit is reached. */
export function submissionRetryDue(attempts: number, now = new Date(), limit = SUBMISSION_RETRY_LIMIT) {
  return attempts < limit ? new Date(now.getTime() + SUBMISSION_RETRY_DELAY_MS * 2 ** attempts) : null;
}
