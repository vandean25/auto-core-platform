import type { Prisma } from '@prisma/client';

export type SavedViewCleanupClient = {
  savedView: {
    deleteMany: Prisma.TransactionClient['savedView']['deleteMany'];
    updateMany: Prisma.TransactionClient['savedView']['updateMany'];
  };
};

/**
 * Deletes a removed member's PERSONAL saved views and nulls owner_user_id on
 * their TENANT saved views in the same transaction as membership removal.
 */
export async function cleanupSavedViewsForRemovedMember(
  tx: SavedViewCleanupClient,
  tenantId: string,
  userId: string,
): Promise<void> {
  await tx.savedView.deleteMany({
    where: {
      tenant_id: tenantId,
      owner_user_id: userId,
      visibility: 'PERSONAL',
    },
  });

  await tx.savedView.updateMany({
    where: {
      tenant_id: tenantId,
      owner_user_id: userId,
      visibility: 'TENANT',
    },
    data: {
      owner_user_id: null,
    },
  });
}
