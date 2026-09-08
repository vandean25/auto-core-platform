import { cleanDb } from './clean-db';

describe('cleanDb', () => {
  it('discovers existing tables in single query and deletes in topological order', async () => {
    const executedDeletes: string[] = [];

    const mockPrisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        { table_name: 'tenants' },
        { table_name: 'brands' },
        { table_name: 'storage_locations' },
        { table_name: 'inventory_stocks' },
        { table_name: 'inventory_transactions' },
      ]),
      tenant: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () => executedDeletes.push('tenants')),
      },
      brand: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () => executedDeletes.push('brands')),
      },
      storageLocation: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('storage_locations'),
          ),
      },
      inventoryStock: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('inventory_stocks'),
          ),
      },
      inventoryTransaction: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('inventory_transactions'),
          ),
      },
    };

    const cleaned = await cleanDb(mockPrisma);

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(cleaned).toEqual([
      'inventory_transactions',
      'inventory_stocks',
      'storage_locations',
      'brands',
      'tenants',
    ]);
    expect(executedDeletes).toEqual([
      'inventory_transactions',
      'inventory_stocks',
      'storage_locations',
      'brands',
      'tenants',
    ]);
  });

  it('skips tables that do not exist in the database', async () => {
    const mockPrisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const cleaned = await cleanDb(mockPrisma);

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(cleaned).toEqual([]);
  });

  it('deletes self-referencing labor categories with parent_id first', async () => {
    const deleteCalls: unknown[] = [];
    const mockPrisma: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ table_name: 'labor_categories' }]),
      laborCategory: {
        deleteMany: jest.fn().mockImplementation(async (args) => {
          deleteCalls.push(args ?? 'all');
        }),
      },
    };

    const cleaned = await cleanDb(mockPrisma);

    expect(cleaned).toEqual(['labor_categories']);
    expect(deleteCalls).toEqual([
      { where: { parent_id: { not: null } } },
      'all',
    ]);
  });
});
