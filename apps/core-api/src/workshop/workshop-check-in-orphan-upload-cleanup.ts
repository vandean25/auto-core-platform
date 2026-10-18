import {
  WorkshopMediaPurpose,
  type Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { WORKSHOP_CHECK_IN_MEDIA_PURPOSES } from './workshop-media-purpose.helpers.js';

export type OrphanCheckInUploadCandidate = {
  id: string;
  storage_bucket: string;
  storage_key: string;
  createdAt: Date;
};

type LockedOrphanRow = {
  id: string;
  purpose: WorkshopMediaPurpose;
  check_in_id: string | null;
  storage_bucket: string;
  storage_key: string;
  createdAt: Date;
};

export function isUnattachedCheckInMediaPurpose(
  purpose: WorkshopMediaPurpose,
): boolean {
  return WORKSHOP_CHECK_IN_MEDIA_PURPOSES.has(purpose);
}

export async function listOrphanCheckInUploadCandidates(
  prisma: PrismaService,
  tenantId: string,
  cutoff: Date,
  take: number,
): Promise<OrphanCheckInUploadCandidate[]> {
  return prisma.workshopMedia.findMany({
    where: {
      tenant_id: tenantId,
      check_in_id: null,
      purpose: {
        in: [
          WorkshopMediaPurpose.CHECK_IN,
          WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
        ],
      },
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take,
    select: {
      id: true,
      storage_bucket: true,
      storage_key: true,
      createdAt: true,
    },
  });
}

async function lockOrphanMediaRow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  mediaId: string,
): Promise<LockedOrphanRow | null> {
  // eslint-disable-next-line no-restricted-syntax -- Row lock serializes orphan purge vs late attachment.
  const rows = await tx.$queryRaw<LockedOrphanRow[]>`
    SELECT id, purpose, check_in_id, storage_bucket, storage_key, "createdAt"
    FROM workshop_media
    WHERE id = ${mediaId} AND tenant_id = ${tenantId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export type PurgeOrphanCheckInUploadResult =
  | { outcome: 'deleted' }
  | { outcome: 'skipped' }
  | { outcome: 'missing' };

/**
 * Deletes unattached check-in media after the row lock confirms it is still orphaned
 * and older than the TTL cutoff. Removes the DB row before storage so a row never
 * points at a deleted object; leftover bytes are removed best-effort afterward.
 */
export async function purgeOrphanCheckInUpload(
  prisma: PrismaService,
  mediaStorage: MechanicMediaStorage,
  tenantId: string,
  mediaId: string,
  cutoff: Date,
): Promise<PurgeOrphanCheckInUploadResult> {
  const deleted = await prisma.$transaction(async (tx) => {
    const locked = await lockOrphanMediaRow(tx, tenantId, mediaId);
    if (!locked) {
      return null;
    }
    if (locked.check_in_id !== null) {
      return null;
    }
    if (!isUnattachedCheckInMediaPurpose(locked.purpose)) {
      return null;
    }
    if (locked.createdAt >= cutoff) {
      return null;
    }

    await tx.workshopMedia.delete({
      where: { tenant_id: tenantId, id: locked.id },
    });
    return {
      storage_bucket: locked.storage_bucket,
      storage_key: locked.storage_key,
    };
  });

  if (!deleted) {
    const exists = await prisma.workshopMedia.findFirst({
      where: { tenant_id: tenantId, id: mediaId },
      select: { id: true },
    });
    return exists ? { outcome: 'skipped' } : { outcome: 'missing' };
  }

  await mediaStorage.deleteObjectIfExists(
    deleted.storage_bucket,
    deleted.storage_key,
  );
  return { outcome: 'deleted' };
}

export async function purgeOrphanCheckInUploadsForTenant(
  prisma: PrismaService,
  mediaStorage: MechanicMediaStorage,
  tenantId: string,
  cutoff: Date,
  batchSize: number,
): Promise<{ scanned: number; deleted: number; skipped: number }> {
  const candidates = await listOrphanCheckInUploadCandidates(
    prisma,
    tenantId,
    cutoff,
    batchSize,
  );
  let deleted = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const result = await purgeOrphanCheckInUpload(
      prisma,
      mediaStorage,
      tenantId,
      candidate.id,
      cutoff,
    );
    if (result.outcome === 'deleted') {
      deleted += 1;
    } else {
      skipped += 1;
    }
  }
  return { scanned: candidates.length, deleted, skipped };
}
