import { seedLabor, resolveCategoryId } from './labor.fixture';

describe('seedLabor', () => {
  it('resolves category id from operation code prefix', () => {
    const categoryByPrefix = {
      ENG: 'cat-eng',
      BRK: 'cat-brk',
    };

    expect(resolveCategoryId('ENG-001', categoryByPrefix)).toBe('cat-eng');
    expect(resolveCategoryId('BRK-002', categoryByPrefix)).toBe('cat-brk');
    expect(resolveCategoryId('UNKNOWN-999', categoryByPrefix)).toBeNull();
  });

  it('batches labor operations and optimizes categorization via updateMany', async () => {
    const upsertedOps: string[] = [];
    const updateManyCalls: any[] = [];

    const mockPrisma: any = {
      laborCategory: {
        upsert: jest.fn().mockImplementation(async ({ create }) => ({
          id: `cat-${create.name.toLowerCase()}`,
          name: create.name,
        })),
      },
      laborOperation: {
        upsert: jest.fn().mockImplementation(async ({ create }) => {
          upsertedOps.push(create.code);
          return { id: `op-${create.code}`, ...create };
        }),
        updateMany: jest.fn().mockImplementation(async (args) => {
          updateManyCalls.push(args);
          return { count: 1 };
        }),
        findFirst: jest.fn().mockImplementation(async ({ where }) => ({
          id: `op-${where.code}`,
          code: where.code,
        })),
      },
      laborFitment: {
        create: jest.fn().mockResolvedValue({ id: 'fitment-1' }),
      },
    };

    const result = await seedLabor(mockPrisma, 'tenant-1');

    expect(result.categoryRecords).toHaveLength(6);
    expect(upsertedOps).toHaveLength(25);
    // updateMany is called per prefix (6 times) instead of serial loop
    expect(updateManyCalls).toHaveLength(6);
    expect(mockPrisma.laborFitment.create).toHaveBeenCalledTimes(2);
  });
});
