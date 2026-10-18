import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { cronJobAdvisoryLockKeys } from './cron-job-advisory-lock-key.js';

export type CronJobAdvisoryLockDb = Pick<
  PrismaClient,
  '$queryRaw' | '$executeRaw'
>;

const defaultLogger = new Logger('CronJobAdvisoryLock');

export async function tryAcquireCronJobAdvisoryLock(
  db: CronJobAdvisoryLockDb,
  jobName: string,
): Promise<boolean> {
  const [key1, key2] = cronJobAdvisoryLockKeys(jobName);
  // eslint-disable-next-line no-restricted-syntax -- session advisory lock; not tenant-scoped data.
  const rows = await db.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${key1}::int, ${key2}::int) AS acquired
  `;
  return rows[0]?.acquired === true;
}

export async function releaseCronJobAdvisoryLock(
  db: CronJobAdvisoryLockDb,
  jobName: string,
): Promise<void> {
  const [key1, key2] = cronJobAdvisoryLockKeys(jobName);
  // eslint-disable-next-line no-restricted-syntax -- pairs with pg_try_advisory_lock above.
  await db.$executeRaw`
    SELECT pg_advisory_unlock(${key1}::int, ${key2}::int)
  `;
}

/**
 * Runs `fn` when this process holds the cluster-wide cron lock for `jobName`.
 * Returns whether the job ran (false when another instance holds the lock).
 */
export async function withCronJobLock(
  db: CronJobAdvisoryLockDb,
  jobName: string,
  fn: () => Promise<void>,
  logger: Pick<Logger, 'log'> = defaultLogger,
): Promise<boolean> {
  const acquired = await tryAcquireCronJobAdvisoryLock(db, jobName);
  if (!acquired) {
    logger.log(
      `Skipping cron job "${jobName}": advisory lock held by another instance.`,
    );
    return false;
  }
  try {
    await fn();
    return true;
  } finally {
    await releaseCronJobAdvisoryLock(db, jobName);
  }
}
