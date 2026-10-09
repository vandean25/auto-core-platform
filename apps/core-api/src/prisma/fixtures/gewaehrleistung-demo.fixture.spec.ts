import { seedDemoGewaehrleistungSales } from './gewaehrleistung-demo.fixture.js';

describe('seedDemoGewaehrleistungSales', () => {
  it('seeds distinct consumer, negotiated consumer, and B2B sale facts with the expected snapshots', async () => {
    const prisma = {
      customer: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: `customer-${data.email}`, ...data }),
          ),
      },
      vehicle: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: `vehicle-${data.vin}`, ...data }),
          ),
        update: jest.fn().mockResolvedValue({}),
      },
      vehicleSale: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: `sale-${data.sale_number}`, ...data }),
          ),
        update: jest.fn().mockResolvedValue({}),
      },
      invoiceSequence: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }) => Promise.resolve(create)),
      },
      invoice: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: `invoice-${data.vehicle_sale_id}`,
            ...data,
            customer: { type: 'PRIVATE' },
            vehicle: { make: 'Demo', model: 'Vehicle', year: 2020 },
            items: [
              { id: `item-${data.vehicle_sale_id}`, ...data.items.create },
            ],
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invoiceItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vehicleLedgerEntry: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((work) => work(prisma)),
    } as any;
    const foundation = {
      defaultTenant: { id: 'tenant-1' },
      defaultLegalEntity: { id: 'legal-entity-1' },
      mainSite: { id: 'site-main' },
    } as any;
    const showroom = { id: 'showroom-1' } as any;
    const snapshotCommit = {
      commitV2Snapshot: jest.fn().mockResolvedValue({}),
    } as any;

    await seedDemoGewaehrleistungSales(
      prisma,
      foundation,
      showroom,
      { id: 'vendor-1' },
      snapshotCommit,
    );

    expect(prisma.vehicleSale.create).toHaveBeenCalledTimes(3);
    const sales = prisma.vehicleSale.create.mock.calls.map(
      ([{ data }]: [{ data: Record<string, any> }]) => data,
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
          status: 'DRAFT',
        }),
        expect.objectContaining({
          sale_number: 'DEMO-GW-1Y',
          contract_concluded_at: new Date('2025-10-20T00:00:00.000Z'),
          handed_over_at: new Date('2025-10-25T00:00:00.000Z'),
          buyer_is_consumer: true,
          gewaehrleistung_shortened_negotiated: true,
          gewaehrleistung_ends_on: new Date('2026-10-25T00:00:00.000Z'),
          presumption_ends_on: new Date('2026-10-25T00:00:00.000Z'),
          status: 'DRAFT',
        }),
        expect.objectContaining({
          sale_number: 'DEMO-GW-B2B',
          contract_concluded_at: new Date('2026-10-01T00:00:00.000Z'),
          handed_over_at: new Date('2026-10-06T00:00:00.000Z'),
          buyer_is_consumer: false,
          gewaehrleistung_shortened_negotiated: false,
          gewaehrleistung_ends_on: null,
          presumption_ends_on: null,
          status: 'DRAFT',
        }),
      ]),
    );
    expect(prisma.invoice.create).toHaveBeenCalledTimes(3);
    expect(snapshotCommit.commitV2Snapshot).toHaveBeenCalledTimes(3);
    expect(prisma.vehicleLedgerEntry.create).toHaveBeenCalledTimes(3);
    expect(prisma.vehicle.update).toHaveBeenCalledTimes(3);
    for (const [{ data }] of prisma.vehicleSale.update.mock.calls) {
      expect(data).toMatchObject({
        status: 'INVOICED',
        cost_basis_snapshot: expect.anything(),
        margin_vat_snapshot: expect.anything(),
        days_to_sell_snapshot: expect.any(Number),
      });
    }
    for (const [{ data }] of prisma.vehicle.create.mock.calls) {
      expect(data.inventory_role).toBe('USED');
      expect(data.stock_status).toBe('IN_STOCK');
      expect(data.stock_cost_basis).toBeDefined();
      expect(data.purchases.create.status).toBe('RECEIVED');
      expect(data.ledger_entries.create.entry_type).toBe('PURCHASE');
      expect(data.ledger_entries.create.amount).toBe(data.stock_cost_basis);
    }
    for (const [{ data }] of prisma.invoice.create.mock.calls) {
      expect(data.status).toBe('FINALIZED');
      expect(data.tax_mode).toBe('MARGIN_SCHEME');
      expect(data.items.create).toMatchObject({
        revenue_group_name: 'Vehicle used (margin)',
      });
      expect(data.items.create.quantity.toString()).toBe('1');
      expect(data.items.create.tax_rate.toString()).toBe('20');
    }
    for (const [{ data }] of prisma.vehicleLedgerEntry.create.mock.calls) {
      expect(data.entry_type).toBe('SALE');
      expect(data.amount.toNumber()).toBeLessThan(0);
      expect(data.vehicle_sale_id).toMatch(/^sale-/);
    }
    for (const [{ data }] of prisma.vehicle.update.mock.calls) {
      expect(data).toMatchObject({
        inventory_role: 'CUSTOMER',
        stock_status: null,
        stock_cost_basis: null,
        stock_received_at: null,
        reserved_for_customer_id: null,
      });
    }
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'tenant-1',
        type: 'COMPANY',
      }),
    });
    const createdCustomers = prisma.customer.create.mock.calls.map(
      ([{ data }]: [{ data: Record<string, any> }]) => data,
    );
    const demoPrivateCustomers = createdCustomers.filter(
      (customer: Record<string, any>) => customer.type === 'PRIVATE',
    );
    expect(demoPrivateCustomers).toHaveLength(2);
    expect(
      demoPrivateCustomers.map(
        (customer: Record<string, any>) => customer.email,
      ),
    ).toEqual([
      'demo.gewaehrleistung.2y@example.at',
      'demo.gewaehrleistung.1y@example.at',
    ]);
    for (const customer of demoPrivateCustomers) {
      expect(customer).toMatchObject({
        address_street: expect.any(String),
        address_zip: expect.any(String),
        address_city: expect.any(String),
        address_country: expect.any(String),
      });
    }
    expect(
      sales.find(
        (sale: Record<string, any>) => sale.sale_number === 'DEMO-GW-2Y',
      )?.customer_id,
    ).toBe('customer-demo.gewaehrleistung.2y@example.at');
    expect(
      sales.find(
        (sale: Record<string, any>) => sale.sale_number === 'DEMO-GW-1Y',
      )?.customer_id,
    ).toBe('customer-demo.gewaehrleistung.1y@example.at');
    expect(
      sales.filter((sale: Record<string, any>) => sale.buyer_is_consumer),
    ).toHaveLength(2);
    for (const [{ data }] of prisma.vehicle.create.mock.calls) {
      expect(data.site_id).toBe('site-main');
      expect(data.location_id).toBe('showroom-1');
    }
    for (const sale of sales) {
      expect(sale.contract_concluded_at).not.toEqual(sale.handed_over_at);
    }
  });
});
