import { seedInventory } from './inventory.fixture.js';

describe('seedInventory', () => {
  const createMockPrisma = () => ({
    storageLocation: {
      upsert: jest
        .fn()
        .mockImplementation(async ({ create }) => ({
          id: `loc-${create.code}`,
          site_id: create.site_id,
          ...create,
        })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    catalogItem: {
      upsert: jest
        .fn()
        .mockImplementation(async ({ create }) => ({
          id: `part-${create.sku}`,
          ...create,
        })),
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryTransaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 10 }),
    },
    inventoryStock: {
      createMany: jest.fn().mockResolvedValue({ count: 10 }),
    },
  });

  const foundation = {
    defaultTenant: { id: 'tenant-1' } as any,
    defaultLegalEntity: { id: 'le-1' } as any,
    mainSite: { id: 'site-main' } as any,
    grzSite: { id: 'site-grz' } as any,
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

  it('upserts supersession items and batches 47 auto parts via upsert', async () => {
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

    expect(mockPrisma.catalogItem.upsert).toHaveBeenCalledTimes(50);

    const batchPartsPayload = mockPrisma.catalogItem.upsert.mock.calls
      .slice(3)
      .map((call: any) => call[0].create);
    expect(batchPartsPayload).toHaveLength(47);
    expect(batchPartsPayload[0].sku).toBe('OF-1001-VOL');
    expect(batchPartsPayload[0].cost_price).toBe(11);
    expect(batchPartsPayload[0].retail_price).toBe(61);

    expect(mockPrisma.inventoryTransaction.createMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.inventoryStock.createMany).toHaveBeenCalledTimes(1);
  });

  it('produces completely deterministic catalog items and stock across multiple seed runs', async () => {
    const run1Prisma: any = createMockPrisma();
    const run2Prisma: any = createMockPrisma();

    await seedInventory(run1Prisma, foundation, finance, brands as any);
    await seedInventory(run2Prisma, foundation, finance, brands as any);

    const run1Parts = run1Prisma.catalogItem.upsert.mock.calls
      .slice(3)
      .map((call: any) => call[0].create);
    const run2Parts = run2Prisma.catalogItem.upsert.mock.calls
      .slice(3)
      .map((call: any) => call[0].create);
    expect(run1Parts).toEqual(run2Parts);

    const run1Tx =
      run1Prisma.inventoryTransaction.createMany.mock.calls[0][0].data;
    const run2Tx =
      run2Prisma.inventoryTransaction.createMany.mock.calls[0][0].data;
    expect(run1Tx).toEqual(run2Tx);

    const run1Stock =
      run1Prisma.inventoryStock.createMany.mock.calls[0][0].data;
    const run2Stock =
      run2Prisma.inventoryStock.createMany.mock.calls[0][0].data;
    expect(run1Stock).toEqual(run2Stock);
  });

  it('skips ledger bootstrap when seed transactions already exist', async () => {
    const mockPrisma: any = createMockPrisma();
    mockPrisma.inventoryTransaction.findFirst.mockResolvedValueOnce({
      id: 'existing-tx',
    });

    await seedInventory(mockPrisma, foundation, finance, brands as any);

    expect(mockPrisma.inventoryTransaction.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.inventoryStock.createMany).not.toHaveBeenCalled();
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
