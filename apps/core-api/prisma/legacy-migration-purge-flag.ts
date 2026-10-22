import type { Prisma } from '@prisma/client';

/** Transaction-local flag so write-once triggers allow test/purge deletes (AUT-628). */
export async function enableLegacyMigrationPurgeFlag(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('acp.allow_purge', 'on', true)`;
}
