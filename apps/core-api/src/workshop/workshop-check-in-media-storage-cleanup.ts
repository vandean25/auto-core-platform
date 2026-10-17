import type { PrismaService } from '../prisma/prisma.service.js';
import type { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';

/** Deletes a check-in photo object only when no workshop_media row still references it. */
export async function deleteCheckInStoredPhotoIfUnreferenced(
  prisma: PrismaService,
  mediaStorage: MechanicMediaStorage,
  tenantId: string,
  storageBucket: string,
  storageKey: string,
): Promise<void> {
  const referenced = await prisma.workshopMedia.findFirst({
    where: {
      tenant_id: tenantId,
      storage_bucket: storageBucket,
      storage_key: storageKey,
    },
    select: { id: true },
  });
  if (!referenced) {
    await mediaStorage
      .deleteObjectIfExists(storageBucket, storageKey)
      .catch(() => undefined);
  }
}
