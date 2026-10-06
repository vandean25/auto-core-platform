import { seedVehicleStockAgeDemo } from './vehicle-stock-age.fixture.js';

describe('seedVehicleStockAgeDemo', () => {
  it('creates a demo dealer vehicle in every stock age bucket', async () => {
    const prisma = { vehicle: { create: jest.fn().mockResolvedValue({ id: 'vehicle' }) } } as any;
    const foundation = {
      defaultTenant: { id: 'tenant-1' },
      mainSite: { id: 'site-main' },
    } as any;
    const location = { id: 'showroom-1' } as any;

    await seedVehicleStockAgeDemo(prisma, foundation, location);

    expect(prisma.vehicle.create).toHaveBeenCalledTimes(5);
    for (const [{ data }] of prisma.vehicle.create.mock.calls) {
      expect(data.stock_received_at).toEqual(data.purchases.create.received_at);
      expect(data.stock_cost_basis).toBe(data.purchases.create.purchase_price);
    }
    const receivedDays = prisma.vehicle.create.mock.calls.map(
      ([{ data }]: [{ data: Record<string, any> }]) => {
        const receivedAt = data.purchases.create.received_at as Date;
        return Math.floor((Date.now() - receivedAt.getTime()) / 86_400_000);
      },
    );
    expect(receivedDays).toEqual(expect.arrayContaining([
      expect.closeTo(15, 1), expect.closeTo(45, 1), expect.closeTo(75, 1),
      expect.closeTo(120, 1), expect.closeTo(220, 1),
    ]));
  });
});
