import { seedFixedStagingTotes } from './seed-staging-totes';

type MockLocation = {
  id: string;
  code: string;
  name: string;
  type: 'staging_tote' | 'warehouse' | 'bin';
  parent_id: string | null;
  deletedAt: Date | null;
};

describe('seedFixedStagingTotes', () => {
  function createPrismaMock(initialLocations: MockLocation[] = []) {
    const locationMap = new Map(initialLocations.map((location) => [location.code, location]));

    const storageLocation = {
      findMany: jest.fn().mockImplementation(async (args: { where: { code: { in: string[] } } }) => {
        const codes = args.where.code.in;
        return codes
          .map((code) => locationMap.get(code))
          .filter((location): location is MockLocation => Boolean(location))
          .map((location) => ({
            code: location.code,
            name: location.name,
            type: location.type,
            parent_id: location.parent_id,
            deletedAt: location.deletedAt,
          }));
      }),
      upsert: jest.fn().mockImplementation(async (args: {
        where: { code: string };
        update: {
          name: string;
          type: 'staging_tote';
          parent_id: string | null;
          deletedAt?: Date | null;
        };
        create: {
          code: string;
          name: string;
          type: 'staging_tote';
          parent_id: string | null;
          deletedAt?: Date | null;
        };
      }) => {
        const existing = locationMap.get(args.where.code);
        const next = existing
          ? {
              ...existing,
              name: args.update.name,
              type: args.update.type,
              parent_id: args.update.parent_id,
              deletedAt:
                args.update.deletedAt === undefined
                  ? existing.deletedAt
                  : args.update.deletedAt,
            }
          : {
              id: `id-${args.where.code}`,
              code: args.create.code,
              name: args.create.name,
              type: args.create.type,
              parent_id: args.create.parent_id,
              deletedAt: args.create.deletedAt ?? null,
            };

        locationMap.set(args.where.code, next);
        return next;
      }),
    };

    return {
      prisma: { storageLocation } as any,
      locationMap,
    };
  }

  it('creates fixed totes and remains idempotent with deterministic updates', async () => {
    const { prisma, locationMap } = createPrismaMock();

    const firstRun = await seedFixedStagingTotes(prisma, {
      parentLocationId: 'warehouse-1',
    });

    expect(firstRun).toEqual({
      total: 50,
      created: 50,
      updated: 0,
      unchanged: 0,
    });

    expect(locationMap.size).toBe(50);
    expect(locationMap.get('TOTE-001')?.name).toBe('Staging Tote 001');
    expect(locationMap.get('TOTE-050')?.name).toBe('Staging Tote 050');

    const secondRun = await seedFixedStagingTotes(prisma, {
      parentLocationId: 'warehouse-1',
    });

    expect(secondRun).toEqual({
      total: 50,
      created: 0,
      updated: 0,
      unchanged: 50,
    });

    const mutated = locationMap.get('TOTE-010');
    if (!mutated) {
      throw new Error('Expected TOTE-010 to exist in map');
    }

    locationMap.set('TOTE-010', {
      ...mutated,
      name: 'Mutated Tote',
    });

    const thirdRun = await seedFixedStagingTotes(prisma, {
      parentLocationId: 'warehouse-1',
    });

    expect(thirdRun).toEqual({
      total: 50,
      created: 0,
      updated: 1,
      unchanged: 49,
    });

    expect(locationMap.get('TOTE-010')?.name).toBe('Staging Tote 010');
  });

  it('restores soft-deleted fixed tote locations', async () => {
    const { prisma, locationMap } = createPrismaMock([
      {
        id: 'id-TOTE-001',
        code: 'TOTE-001',
        name: 'Staging Tote 001',
        type: 'staging_tote',
        parent_id: 'warehouse-1',
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await seedFixedStagingTotes(prisma, {
      parentLocationId: 'warehouse-1',
    });

    expect(result).toEqual({
      total: 50,
      created: 49,
      updated: 1,
      unchanged: 0,
    });

    expect(locationMap.get('TOTE-001')?.deletedAt).toBeNull();
  });
});
