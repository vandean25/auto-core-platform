import { Pool } from 'pg';
import { resolveRuntimeDatabaseUrl } from './runtime-database-url';

const DEFAULT_RUNTIME_POOL_MAX = 10;

let sharedPool: Pool | undefined;
let ownerCount = 0;

export function getSharedRuntimePool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: resolveRuntimeDatabaseUrl(),
      max: DEFAULT_RUNTIME_POOL_MAX,
    });
  }

  ownerCount += 1;
  return sharedPool;
}

export async function releaseSharedRuntimePool(): Promise<void> {
  if (ownerCount === 0) {
    return;
  }

  ownerCount -= 1;
  if (ownerCount > 0 || !sharedPool) {
    return;
  }

  const pool = sharedPool;
  sharedPool = undefined;
  await pool.end();
}

export async function resetSharedRuntimePool(): Promise<void> {
  ownerCount = 0;
  if (!sharedPool) {
    return;
  }

  const pool = sharedPool;
  sharedPool = undefined;
  await pool.end();
}
