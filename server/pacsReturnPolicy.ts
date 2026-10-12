/** Delay before the next PACS delivery attempt after `attempts` failed ones: 2 min, 10 min, then 30 min. */
export function pacsReturnRetryAt(attempts: number, now = new Date()) {
  const minutes = attempts <= 1 ? 2 : attempts === 2 ? 10 : 30;
  return new Date(now.getTime() + minutes * 60_000);
}

export const PACS_RETURN_POLL_MS = 15_000;
