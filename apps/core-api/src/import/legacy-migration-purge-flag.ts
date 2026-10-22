import type { Prisma } from '@prisma/client';

/** Transaction-local flag so write-once triggers allow test/purge deletes (AUT-628). */
export async function enableLegacyMigrationPurgeFlag(
  tx: Prisma.TransactionClient,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- AUT-628: session flag for DB write-once triggers during purge/clean-db only.
  await tx.$executeRaw`SELECT set_config('acp.allow_purge', 'on', true)`;
}
