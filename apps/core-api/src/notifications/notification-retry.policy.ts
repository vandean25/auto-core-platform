/** Total send attempts per outbox row, including the first. After the last one the row is FAILED. */
export const NOTIFICATION_MAX_ATTEMPTS = 5;

/** Delay before attempt n+1, indexed by attempts already made (1-based). */
const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600] as const;

/** Seconds to wait after `attemptsMade` attempts, or null when the row is out of attempts. */
export function nextRetryDelaySeconds(attemptsMade: number): number | null {
  if (attemptsMade < 1 || attemptsMade >= NOTIFICATION_MAX_ATTEMPTS) {
    return null;
  }
  return RETRY_DELAYS_SECONDS[
    Math.min(attemptsMade - 1, RETRY_DELAYS_SECONDS.length - 1)
  ];
}
