import { seedFinance } from './finance.fixture';

describe('finance.fixture', () => {
  it('creates Austrian standard revenue groups and default finance settings', async () => {
    const mockPrisma: any = {
      revenueGroup: {
        upsert: jest.fn().mockImplementation(async ({ create }) => ({
          id: create.account_number === '4000' ? 1 : 2,
          ...create,
        })),
      },
      financeSettings: {
        upsert: jest.fn().mockImplementation(async ({ create }) => ({
          id: 'fs-1',
          ...create,
        })),
      },
    };

    const result = await seedFinance(mockPrisma, 'tenant-1');

    expect(result.revenueGroups).toHaveLength(3);
    expect(result.defaultRevenueGroup.name).toBe('Parts / Goods 20%');
    expect(result.financeSettings.tenant_id).toBe('tenant-1');
    expect(mockPrisma.revenueGroup.upsert).toHaveBeenCalledTimes(3);
    expect(mockPrisma.financeSettings.upsert).toHaveBeenCalledTimes(1);
  });
});
