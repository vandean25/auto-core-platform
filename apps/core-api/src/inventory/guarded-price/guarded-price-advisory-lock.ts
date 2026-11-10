import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export async function acquireGuardedPriceAdvisoryLock(
  tx: Tx,
  tenantId: string,
  principalId: string,
  key: string,
): Promise<void> {
  const material = `${tenantId}\u{2016}${principalId}\u{2016}${key}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${material}::text, 0))`;
}

export async function setTxLockTimeout5s(tx: Tx): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
}

export async function setTxLockTimeout10s(tx: Tx): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
}
