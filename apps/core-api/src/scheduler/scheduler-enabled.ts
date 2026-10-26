import { isInProcessSchedulerMode } from './scheduler-mode.js';

/**
 * Nest `@Cron` handlers register only in `SCHEDULER_MODE=in-process` (default).
 * Pdf-worker uses `SCHEDULER_MODE=off` (or legacy `SCHEDULER_ENABLED=false`).
 */
export function isSchedulerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isInProcessSchedulerMode(env);
}
