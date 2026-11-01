import type { Prisma } from '@prisma/client';

/**
 * Replay rows exist to rebuild one interpreted sentence. Once the command's
 * proposal reaches a terminal decision the proposal itself is the record, so
 * the row — which holds surname, plate, and VIN tokens — goes with it.
 */
export async function deleteCommandReplays(
  client: Prisma.TransactionClient,
  tenantId: string,
  commandIds: readonly (string | null)[],
): Promise<void> {
  const ids = commandIds.filter((commandId) => commandId !== null);
  if (ids.length === 0) return;
  await client.workshopCommandSession.deleteMany({
    where: { tenant_id: tenantId, command_id: { in: ids } },
  });
}
