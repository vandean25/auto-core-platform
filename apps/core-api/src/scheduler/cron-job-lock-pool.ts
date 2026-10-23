import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { inspectRuntimeDatabaseUrls } from '../prisma/runtime-database-url-health.js';
import { resolveDirectDatabaseUrl } from '../prisma/runtime-database-url.js';

const LOCK_POOL_MAX = 2;
const LOCK_POOL_IDLE_TIMEOUT_MS = 30_000;

const defaultLogger = new Logger('CronJobLockPool');

let lockPool: Pool | undefined;
let retainCount = 0;
let poolerHostWarningLogged = false;

function logPoolerHostWarning(logger: Logger): void {
  if (poolerHostWarningLogged) {
    return;
  }

  const { directHost } = inspectRuntimeDatabaseUrls();
  if (!directHost?.includes('-pooler')) {
    return;
  }

  poolerHostWarningLogged = true;
  logger.warn(
    'Cron advisory lock pool uses DATABASE_URL whose host looks like a pooler; session locks may not behave as expected.',
  );
}

function createLockPool(logger: Logger): Pool {
  const connectionString = resolveDirectDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required for the cron job advisory lock pool.',
    );
  }

  logPoolerHostWarning(logger);
  const pool = new Pool({
    connectionString,
    max: LOCK_POOL_MAX,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: LOCK_POOL_IDLE_TIMEOUT_MS,
  });
  pool.on('error', (error) => {
    logger.error(
      `Cron job lock pool idle client error: ${error.message}`,
      error.stack,
    );
  });
  return pool;
}

export function getCronJobLockPool(): Pool {
  if (!lockPool) {
    lockPool = createLockPool(defaultLogger);
  }

  return lockPool;
}

export function retainCronJobLockPool(logger: Logger = defaultLogger): void {
  if (!lockPool) {
    lockPool = createLockPool(logger);
  }

  retainCount += 1;
}

export async function releaseCronJobLockPool(): Promise<void> {
  if (retainCount === 0) {
    return;
  }

  retainCount -= 1;
  if (retainCount > 0 || !lockPool) {
    return;
  }

  const pool = lockPool;
  lockPool = undefined;
  await pool.end();
}

export async function resetCronJobLockPool(): Promise<void> {
  retainCount = 0;
  if (!lockPool) {
    return;
  }

  const pool = lockPool;
  lockPool = undefined;
  await pool.end();
}
