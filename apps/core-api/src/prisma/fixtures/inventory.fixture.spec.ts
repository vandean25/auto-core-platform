import { seedInventory } from './inventory.fixture';

describe('seedInventory', () => {
  it('batches catalog item creation and records initial stock using createMany', async () => {
    const mockPrisma: any = {
      storageLocation: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: `loc-${data.code}`, ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      catalogItem: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: `part-${data.sku}`, ...data })),
        update: jest.fn().mockResolvedValue({}),
        createManyAndReturn: jest.fn().mockImplementation(async ({ data }) =>
          data.map((d: any, i: number) => ({ id: `batch-part-${i}`, ...d }))
        ),
      },
      inventoryTransaction: {
        createMany: jest.fn().mockResolvedValue({ count: 10 }),
      },
      inventoryStock: {
        createMany: jest.fn().mockResolvedValue({ count: 10 }),
      },
    };

    const brands = [
      { id: 1, name: 'Volkswagen', isPartManufacturer: true, isVehicleMake: true },
      { id: 2, name: 'Bosch', isPartManufacturer: true, isVehicleMake: false },
    ];

    const result = await seedInventory(
      mockPrisma,
      {
        defaultTenant: { id: 'tenant-1' } as any,
        defaultLegalEntity: { id: 'le-1' } as any,
        mainSite: { id: 'site-1' } as any,
        systemLocations: [],
      },
      {
        defaultRevenueGroup: { id: 1 } as any,
        revenueGroups: [],
        financeSettings: {} as any,
      },
      brands as any,
    );

    expect(result.locations).toHaveLength(3);
    expect(result.partA.sku).toBe('06J-115-403-C');
    expect(result.partB.sku).toBe('06J-115-403-Q');
    expect(result.partC.sku).toBe('06J-115-561-B');
    expect(result.otherParts).toHaveLength(47);

    // Verify concurrent part creation and batch initial stock creation
    expect(mockPrisma.catalogItem.create).toHaveBeenCalledTimes(50);
    expect(mockPrisma.inventoryTransaction.createMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.inventoryStock.createMany).toHaveBeenCalledTimes(1);
  });
});
