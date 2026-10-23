import { Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { cronJobAdvisoryLockKeys } from './cron-job-advisory-lock-key.js';
import { getCronJobLockPool } from './cron-job-lock-pool.js';

const defaultLogger = new Logger('CronJobAdvisoryLock');

/** Jobs currently executing `fn` in this Node process (belt under the DB lock). */
const runningInThisProcess = new Set<string>();

export type CronJobLockLogger = {
  log: (message: string) => void;
  warn?: (message: string) => void;
};

async function tryAcquireCronJobAdvisoryLockOnClient(
  client: PoolClient,
  jobName: string,
): Promise<boolean> {
  const [key1, key2] = cronJobAdvisoryLockKeys(jobName);
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired',
    [key1, key2],
  );
  return result.rows[0]?.acquired === true;
}

async function releaseCronJobAdvisoryLockOnClient(
  client: PoolClient,
  jobName: string,
): Promise<boolean> {
  const [key1, key2] = cronJobAdvisoryLockKeys(jobName);
  const result = await client.query<{ released: boolean }>(
    'SELECT pg_advisory_unlock($1::int, $2::int) AS released',
    [key1, key2],
  );
  return result.rows[0]?.released === true;
}

/**
 * Runs `fn` when this process holds the cluster-wide cron lock for `jobName`.
 * The lock is held on one pinned dedicated-pool connection for the whole callback so
 * `pg_try_advisory_lock` / `pg_advisory_unlock` stay on the same Postgres session.
 *
 * Returns whether the job ran (false when another instance holds the lock).
 */
export async function withCronJobLock(
  jobName: string,
  fn: () => Promise<void>,
  logger: CronJobLockLogger = defaultLogger,
): Promise<boolean> {
  if (runningInThisProcess.has(jobName)) {
    logger.log(
      `Skipping cron job "${jobName}": already running in this process.`,
    );
    return false;
  }

  runningInThisProcess.add(jobName);
  const pool = getCronJobLockPool();
  let client: PoolClient | undefined;
  let acquired = false;
  try {
    client = await pool.connect();
    acquired = await tryAcquireCronJobAdvisoryLockOnClient(client, jobName);
    if (!acquired) {
      logger.log(
        `Skipping cron job "${jobName}": advisory lock held by another instance.`,
      );
      return false;
    }

    await fn();
    return true;
  } finally {
    if (client) {
      if (acquired) {
        const released = await releaseCronJobAdvisoryLockOnClient(
          client,
          jobName,
        );
        if (!released) {
          (logger.warn ?? logger.log).call(
            logger,
            `Cron job "${jobName}": pg_advisory_unlock did not release the lock on this session.`,
          );
        }
      }
      client.release();
    }
    runningInThisProcess.delete(jobName);
  }
}
