import { TABLE_CLEANERS, cleanDb } from './clean-db.js';

describe('cleanDb', () => {
  it('discovers existing tables in single query and deletes in topological order', async () => {
    const executedDeletes: string[] = [];

    const mockPrisma: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { table_name: 'tenants' },
          { table_name: 'brands' },
          { table_name: 'storage_locations' },
          { table_name: 'inventory_stocks' },
          { table_name: 'purchase_orders' },
          { table_name: 'purchase_order_items' },
          { table_name: 'purchase_invoices' },
          { table_name: 'purchase_invoice_lines' },
          { table_name: 'parts_requisitions' },
          { table_name: 'parts_requisition_lines' },
          { table_name: 'parts_reservations' },
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
      purchaseOrder: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('purchase_orders'),
          ),
      },
      purchaseOrderItem: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('purchase_order_items'),
          ),
      },
      purchaseInvoice: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('purchase_invoices'),
          ),
      },
      purchaseInvoiceLine: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('purchase_invoice_lines'),
          ),
      },
      partsRequisition: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('parts_requisitions'),
          ),
      },
      partsRequisitionLine: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('parts_requisition_lines'),
          ),
      },
      partsReservation: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('parts_reservations'),
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
      'parts_reservations',
      'parts_requisition_lines',
      'parts_requisitions',
      'purchase_invoice_lines',
      'purchase_invoices',
      'purchase_order_items',
      'purchase_orders',
      'inventory_stocks',
      'storage_locations',
      'brands',
      'tenants',
    ]);
    expect(executedDeletes).toEqual([
      'inventory_transactions',
      'parts_reservations',
      'parts_requisition_lines',
      'parts_requisitions',
      'purchase_invoice_lines',
      'purchase_invoices',
      'purchase_order_items',
      'purchase_orders',
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

  it('cleans accounting exports and profiles before legal entities', () => {
    const tables = TABLE_CLEANERS.map((cleaner) => cleaner.table);
    const exportIndex = tables.indexOf('accounting_exports');
    const profileIndex = tables.indexOf('legal_entity_accounting_profiles');
    const legalEntityIndex = tables.indexOf('legal_entities');

    expect(exportIndex).toBeGreaterThan(-1);
    expect(profileIndex).toBeGreaterThan(-1);
    expect(exportIndex).toBeLessThan(legalEntityIndex);
    expect(profileIndex).toBeLessThan(legalEntityIndex);
  });

  it('runs accounting profile cleaners when those tables exist', async () => {
    const executedDeletes: string[] = [];
    const mockPrisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        { table_name: 'accounting_exports' },
        { table_name: 'legal_entity_accounting_profiles' },
        { table_name: 'legal_entities' },
      ]),
      accountingExport: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('accounting_exports'),
          ),
      },
      legalEntityAccountingProfile: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () =>
            executedDeletes.push('legal_entity_accounting_profiles'),
          ),
      },
      legalEntity: {
        deleteMany: jest
          .fn()
          .mockImplementation(async () => executedDeletes.push('legal_entities')),
      },
    };

    const cleaned = await cleanDb(mockPrisma);

    expect(cleaned).toEqual([
      'accounting_exports',
      'legal_entity_accounting_profiles',
      'legal_entities',
    ]);
    expect(executedDeletes).toEqual([
      'accounting_exports',
      'legal_entity_accounting_profiles',
      'legal_entities',
    ]);
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

  it('cleans only AUT-408 demo sales before their related vehicles and customers', async () => {
    const tables = TABLE_CLEANERS.map((cleaner) => cleaner.table);
    const saleIndex = tables.indexOf('vehicle_sales');
    const vehicleIndex = tables.indexOf('vehicles');
    const customerIndex = tables.indexOf('customers');
    const demoSaleCleaner = TABLE_CLEANERS[saleIndex];
    const vehicleSale = { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) };

    expect(saleIndex).toBeGreaterThan(-1);
    expect(saleIndex).toBeLessThan(vehicleIndex);
    expect(saleIndex).toBeLessThan(customerIndex);

    await demoSaleCleaner.clean({ vehicleSale } as any);

    expect(vehicleSale.deleteMany).toHaveBeenCalledWith({
      where: {
        tenant: { is: { slug: 'default-workshop' } },
        sale_number: { in: ['DEMO-GW-2Y', 'DEMO-GW-1Y', 'DEMO-GW-B2B'] },
      },
    });
  });
});
