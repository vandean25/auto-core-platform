import { createHash } from 'node:crypto';

/** Class id for core-api @Cron advisory locks (AUT-611). */
export const CORE_API_CRON_ADVISORY_LOCK_CLASS = 0x0a_06_11;

/**
 * Stable two-int Postgres advisory lock keys from the Nest cron `name` option.
 */
export function cronJobAdvisoryLockKeys(jobName: string): [number, number] {
  const digest = createHash('sha256')
    .update(`core-api:cron:${jobName}`, 'utf8')
    .digest();
  const key2 =
    ((digest[0]! << 24) |
      (digest[1]! << 16) |
      (digest[2]! << 8) |
      digest[3]!) >>>
    0;
  return [CORE_API_CRON_ADVISORY_LOCK_CLASS, key2];
}
