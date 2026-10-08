import { seedDemoGewaehrleistungSales } from './gewaehrleistung-demo.fixture.js';

describe('seedDemoGewaehrleistungSales', () => {
  it('seeds distinct consumer, negotiated consumer, and B2B sale facts with the expected snapshots', async () => {
    const prisma = {
      customer: {
        create: jest.fn().mockResolvedValue({ id: 'company-customer' }),
      },
      vehicle: {
        create: jest.fn().mockResolvedValue({ id: 'vehicle' }),
      },
    } as any;
    const foundation = {
      defaultTenant: { id: 'tenant-1' },
      mainSite: { id: 'site-main' },
    } as any;
    const customers = [
      { id: 'private-customer-1' },
      { id: 'private-customer-2' },
    ] as any;
    const showroom = { id: 'showroom-1' } as any;

    await seedDemoGewaehrleistungSales(prisma, foundation, customers, showroom);

    expect(prisma.vehicle.create).toHaveBeenCalledTimes(3);
    const sales = prisma.vehicle.create.mock.calls.map(
      ([{ data }]: [{ data: Record<string, any> }]) => data.sales.create,
    );
    expect(sales).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sale_number: 'DEMO-GW-2Y',
          contract_concluded_at: new Date('2024-10-20T00:00:00.000Z'),
          handed_over_at: new Date('2024-10-25T00:00:00.000Z'),
          buyer_is_consumer: true,
          gewaehrleistung_shortened_negotiated: false,
          gewaehrleistung_ends_on: new Date('2026-10-25T00:00:00.000Z'),
          presumption_ends_on: new Date('2025-10-25T00:00:00.000Z'),
        }),
        expect.objectContaining({
          sale_number: 'DEMO-GW-1Y',
          contract_concluded_at: new Date('2025-10-20T00:00:00.000Z'),
          handed_over_at: new Date('2025-10-25T00:00:00.000Z'),
          buyer_is_consumer: true,
          gewaehrleistung_shortened_negotiated: true,
          gewaehrleistung_ends_on: new Date('2026-10-25T00:00:00.000Z'),
          presumption_ends_on: new Date('2026-10-25T00:00:00.000Z'),
        }),
        expect.objectContaining({
          sale_number: 'DEMO-GW-B2B',
          contract_concluded_at: new Date('2026-10-01T00:00:00.000Z'),
          handed_over_at: new Date('2026-10-06T00:00:00.000Z'),
          buyer_is_consumer: false,
          gewaehrleistung_shortened_negotiated: false,
          gewaehrleistung_ends_on: null,
          presumption_ends_on: null,
        }),
      ]),
    );
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'tenant-1',
        type: 'COMPANY',
      }),
    });
    for (const [{ data }] of prisma.vehicle.create.mock.calls) {
      expect(data.inventory_role).toBe('USED');
      expect(data.stock_status).toBe('SOLD');
      expect(data.site_id).toBe('site-main');
      expect(data.location_id).toBe('showroom-1');
      expect(data.sales.create.contract_concluded_at).not.toEqual(
        data.sales.create.handed_over_at,
      );
    }
  });
});
