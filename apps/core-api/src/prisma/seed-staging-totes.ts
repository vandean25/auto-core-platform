import { Prisma } from '@prisma/client';
import type { LocationType, PrismaClient } from '@prisma/client';

const FIXED_TOTE_COUNT = 50;

export interface StagingToteSeedSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
}

type StorageLocationSeedClient =
  | Pick<PrismaClient, 'storageLocation'>
  | Prisma.TransactionClient;

export async function seedFixedStagingTotes(
  prisma: StorageLocationSeedClient,
  options: { parentLocationId?: string | null } = {},
): Promise<StagingToteSeedSummary> {
  const parentLocationId = options.parentLocationId ?? null;
  const stagingToteType = 'staging_tote' as LocationType;
  const toteDefinitions = Array.from({ length: FIXED_TOTE_COUNT }, (_, index) => {
    const suffix = String(index + 1).padStart(3, '0');
    return {
      code: `TOTE-${suffix}`,
      name: `Staging Tote ${suffix}`,
      type: stagingToteType,
      parent_id: parentLocationId,
    };
  });

  const existingTotes = await prisma.storageLocation.findMany({
    where: { code: { in: toteDefinitions.map((definition) => definition.code) } },
    select: {
      code: true,
      name: true,
      type: true,
      parent_id: true,
    },
  });

  const existingByCode = new Map(existingTotes.map((location) => [location.code, location]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  const upsertOperations = toteDefinitions.map((definition) => {
    const existing = existingByCode.get(definition.code);

    if (!existing) {
      created += 1;
    } else if (
      existing.name !== definition.name ||
      existing.type !== definition.type ||
      existing.parent_id !== definition.parent_id
    ) {
      updated += 1;
    } else {
      unchanged += 1;
    }

    return prisma.storageLocation.upsert({
      where: { code: definition.code },
      update: {
        name: definition.name,
        type: definition.type,
        parent_id: definition.parent_id,
      },
      create: {
        code: definition.code,
        name: definition.name,
        type: definition.type,
        parent_id: definition.parent_id,
      },
    });
  });

  await Promise.all(upsertOperations);

  return {
    total: FIXED_TOTE_COUNT,
    created,
    updated,
    unchanged,
  };
}
