import { seedInventory } from './inventory.fixture';

describe('seedInventory', () => {
  const createMockPrisma = () => ({
    storageLocation: {
      create: jest
        .fn()
        .mockImplementation(async ({ data }) => ({
          id: `loc-${data.code}`,
          ...data,
        })),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    catalogItem: {
      create: jest
        .fn()
        .mockImplementation(async ({ data }) => ({
          id: `part-${data.sku}`,
          ...data,
        })),
      update: jest.fn().mockResolvedValue({}),
      createManyAndReturn: jest
        .fn()
        .mockImplementation(async ({ data }) =>
          data.map((d: any, i: number) => ({ id: `batch-part-${i}`, ...d })),
        ),
    },
    inventoryTransaction: {
      createMany: jest.fn().mockResolvedValue({ count: 10 }),
    },
    inventoryStock: {
      createMany: jest.fn().mockResolvedValue({ count: 10 }),
    },
  });

  const foundation = {
    defaultTenant: { id: 'tenant-1' } as any,
    defaultLegalEntity: { id: 'le-1' } as any,
    mainSite: { id: 'site-1' } as any,
    systemLocations: [],
  };

  const finance = {
    defaultRevenueGroup: { id: 1 } as any,
    revenueGroups: [],
    financeSettings: {} as any,
  };

  const brands = [
    {
      id: 1,
      name: 'Volkswagen',
      isPartManufacturer: true,
      isVehicleMake: true,
    },
    { id: 2, name: 'Bosch', isPartManufacturer: true, isVehicleMake: false },
  ];

  it('creates supersession items individually and batches 47 auto parts via createManyAndReturn', async () => {
    const mockPrisma: any = createMockPrisma();

    const result = await seedInventory(
      mockPrisma,
      foundation,
      finance,
      brands as any,
    );

    expect(result.locations).toHaveLength(3);
    expect(result.partA.sku).toBe('06J-115-403-C');
    expect(result.partB.sku).toBe('06J-115-403-Q');
    expect(result.partC.sku).toBe('06J-115-561-B');
    expect(result.otherParts).toHaveLength(47);

    // 3 individual creates for supersession parts A, B, C
    expect(mockPrisma.catalogItem.create).toHaveBeenCalledTimes(3);

    // 1 batch createManyAndReturn for the 47 additional parts
    expect(mockPrisma.catalogItem.createManyAndReturn).toHaveBeenCalledTimes(1);
    const batchPartsPayload =
      mockPrisma.catalogItem.createManyAndReturn.mock.calls[0][0].data;
    expect(batchPartsPayload).toHaveLength(47);
    expect(batchPartsPayload[0].sku).toBe('OF-1001-VOL');
    expect(batchPartsPayload[0].cost_price).toBe(11);
    expect(batchPartsPayload[0].retail_price).toBe(61);

    // 1 batch createMany for ledger transactions and 1 for cached stock
    expect(mockPrisma.inventoryTransaction.createMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.inventoryStock.createMany).toHaveBeenCalledTimes(1);
  });

  it('produces completely deterministic catalog items and stock across multiple seed runs', async () => {
    const run1Prisma: any = createMockPrisma();
    const run2Prisma: any = createMockPrisma();

    await seedInventory(run1Prisma, foundation, finance, brands as any);
    await seedInventory(run2Prisma, foundation, finance, brands as any);

    // Assert catalogItem.createManyAndReturn payloads are identical
    const run1Parts =
      run1Prisma.catalogItem.createManyAndReturn.mock.calls[0][0].data;
    const run2Parts =
      run2Prisma.catalogItem.createManyAndReturn.mock.calls[0][0].data;
    expect(run1Parts).toEqual(run2Parts);

    // Assert inventoryTransaction.createMany payloads are identical
    const run1Tx =
      run1Prisma.inventoryTransaction.createMany.mock.calls[0][0].data;
    const run2Tx =
      run2Prisma.inventoryTransaction.createMany.mock.calls[0][0].data;
    expect(run1Tx).toEqual(run2Tx);

    // Assert inventoryStock.createMany payloads are identical
    const run1Stock =
      run1Prisma.inventoryStock.createMany.mock.calls[0][0].data;
    const run2Stock =
      run2Prisma.inventoryStock.createMany.mock.calls[0][0].data;
    expect(run1Stock).toEqual(run2Stock);
  });

  it('throws an error if no part manufacturer brands are provided', async () => {
    const mockPrisma: any = createMockPrisma();
    const noPartBrands = [
      { id: 3, name: 'Tesla', isPartManufacturer: false, isVehicleMake: true },
    ];

    await expect(
      seedInventory(mockPrisma, foundation, finance, noPartBrands as any),
    ).rejects.toThrow(
      'No part manufacturer brands available for inventory seeding',
    );
  });
});
