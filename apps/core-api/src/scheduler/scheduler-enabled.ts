/**
 * Cron scheduling runs only where `SCHEDULER_ENABLED` is not `false`.
 * The pdf-worker service shares the core-api image and sets it to `false`
 * so recovery crons run once per tick on core-api only (AUT-715).
 */
export function isSchedulerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.SCHEDULER_ENABLED?.trim().toLowerCase() !== 'false';
}
