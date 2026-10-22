import * as fs from 'node:fs';
import * as path from 'node:path';
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
      'brands',
      'storage_locations',
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
      'brands',
      'storage_locations',
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

  it('cleans vehicle parties and notices before workshop orders, vehicles and customers', () => {
    const tables = TABLE_CLEANERS.map((cleaner) => cleaner.table);

    for (const table of ['vehicle_parties', 'vehicle_notices']) {
      const index = tables.indexOf(table);
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(tables.indexOf('workshop_orders'));
      expect(index).toBeLessThan(tables.indexOf('vehicles'));
      expect(index).toBeLessThan(tables.indexOf('customers'));
    }
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
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
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
          .mockImplementation(async () =>
            executedDeletes.push('legal_entities'),
          ),
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

  it('orders AUT-408 demo cleaners by sale, trade-in purchase and vehicle foreign keys', async () => {
    const tables = TABLE_CLEANERS.map((cleaner) => cleaner.table);
    const saleIndex = tables.indexOf('vehicle_sales');
    const vehicleIndex = tables.indexOf('vehicles');
    const customerIndex = tables.indexOf('customers');
    const demoSaleCleaner = TABLE_CLEANERS[saleIndex];
    const invoiceCleaner = TABLE_CLEANERS[tables.indexOf('invoices')];
    const ledgerCleaner =
      TABLE_CLEANERS[tables.indexOf('vehicle_ledger_entries')];
    const purchaseCleaner = TABLE_CLEANERS[tables.indexOf('vehicle_purchases')];
    const customerCleaner = TABLE_CLEANERS[tables.indexOf('customers')];
    const vehicleSale = {
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
    };
    const invoice = { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) };
    const vehicleLedgerEntry = {
      deleteMany: jest.fn().mockResolvedValue({ count: 6 }),
    };
    const vehiclePurchase = {
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
    };
    const vehicle = {
      findMany: jest.fn().mockResolvedValue([{ id: 'demo-v1' }]),
    };
    const customer = { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) };

    expect(saleIndex).toBeGreaterThan(-1);
    expect(saleIndex).toBeLessThan(vehicleIndex);
    expect(saleIndex).toBeLessThan(customerIndex);
    for (const table of ['invoices', 'vehicle_ledger_entries']) {
      const index = tables.indexOf(table);
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(saleIndex);
      expect(index).toBeLessThan(vehicleIndex);
    }
    // vehicle_sales.trade_in_purchase_id references vehicle_purchases with
    // ON DELETE RESTRICT, so a trade-in sale is cleaned before its purchase.
    const purchaseIndex = tables.indexOf('vehicle_purchases');
    expect(purchaseIndex).toBeGreaterThan(saleIndex);
    expect(purchaseIndex).toBeLessThan(vehicleIndex);

    await invoiceCleaner.clean({ invoice } as any);
    expect(invoice.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        tenant: { is: { slug: 'default-workshop' } },
        vehicle_sale: {
          is: {
            sale_number: { in: ['DEMO-GW-2Y', 'DEMO-GW-1Y', 'DEMO-GW-B2B'] },
          },
        },
      },
    });
    expect(invoice.deleteMany).toHaveBeenNthCalledWith(2);
    await ledgerCleaner.clean({ vehicle, vehicleLedgerEntry } as any);
    expect(vehicle.findMany).toHaveBeenCalledWith({
      where: {
        tenant: { is: { slug: 'default-workshop' } },
        vin: {
          in: ['WARRANTYDEMO00001', 'WARRANTYDEMO00002', 'WARRANTYDEMO00003'],
        },
      },
      select: { id: true },
    });
    expect(vehicleLedgerEntry.deleteMany).toHaveBeenCalledWith({
      where: { vehicle_id: { in: ['demo-v1'] } },
    });
    await purchaseCleaner.clean({ vehiclePurchase } as any);
    expect(vehiclePurchase.deleteMany).toHaveBeenCalledWith({
      where: {
        tenant: { is: { slug: 'default-workshop' } },
        purchase_number: {
          in: [
            'AUT408-GW-DEMO-GW-2Y',
            'AUT408-GW-DEMO-GW-1Y',
            'AUT408-GW-DEMO-GW-B2B',
          ],
        },
      },
    });

    await demoSaleCleaner.clean({ vehicleSale } as any);

    expect(vehicleSale.deleteMany).toHaveBeenCalledWith({
      where: {
        tenant: { is: { slug: 'default-workshop' } },
        sale_number: { in: ['DEMO-GW-2Y', 'DEMO-GW-1Y', 'DEMO-GW-B2B'] },
      },
    });
    await customerCleaner.clean({ customer } as any);
    expect(customer.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        tenant: { is: { slug: 'default-workshop' } },
        email: {
          in: [
            'demo.gewaehrleistung.2y@example.at',
            'demo.gewaehrleistung.1y@example.at',
            'demo.gewaehrleistung.b2b@example.at',
          ],
        },
      },
    });
    expect(customer.deleteMany).toHaveBeenNthCalledWith(2);
  });

  it('keeps platform agent policy rules when cleaning tenant rules', async () => {
    const agentPolicyRule = {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const tables = TABLE_CLEANERS.map((cleaner) => cleaner.table);
    const agentPolicyCleaner =
      TABLE_CLEANERS[tables.indexOf('agent_policy_rules')];

    await agentPolicyCleaner.clean({ agentPolicyRule } as any);

    expect(agentPolicyRule.deleteMany).toHaveBeenCalledWith({
      where: { tenant_id: { not: null } },
    });
  });
});

const schema = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'prisma',
    'schema.prisma',
  ),
  'utf8',
);

interface SchemaForeignKey {
  table: string;
  parentTable: string;
  columns: string[];
}

function readSchemaForeignKeys(): SchemaForeignKey[] {
  const models = new Map<string, { table: string; body: string }>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const mapped = match[2].match(/@@map\("([^"]+)"\)/);
    models.set(match[1], { table: mapped?.[1] ?? match[1], body: match[2] });
  }
  const foreignKeys: SchemaForeignKey[] = [];
  for (const { table, body } of models.values()) {
    for (const line of body.split('\n')) {
      const relation = line.match(/^\s+\w+\s+(\w+)\??\s+@relation\((.*)\)\s*$/);
      const parent = relation && models.get(relation[1]);
      const fields = relation?.[2].match(/fields:\s*\[([^\]]*)\]/)?.[1];
      if (parent && fields) {
        foreignKeys.push({
          table,
          parentTable: parent.table,
          columns: fields.split(',').map((column) => column.trim()),
        });
      }
    }
  }
  return foreignKeys;
}

describe('TABLE_CLEANERS against prisma/schema.prisma', () => {
  const tables = TABLE_CLEANERS.map((cleaner) => cleaner.table);
  const foreignKeys = readSchemaForeignKeys();

  it('parses every relation that declares fields', () => {
    expect(foreignKeys).toHaveLength(schema.match(/fields:/g)?.length ?? 0);
  });

  it('cleans every table with a tenant_id foreign key before tenants', () => {
    const tenantTables = new Set(
      foreignKeys
        .filter((foreignKey) => foreignKey.columns.includes('tenant_id'))
        .map((foreignKey) => foreignKey.table),
    );
    const uncleaned = [...tenantTables].filter(
      (table) => !tables.includes(table),
    );
    const cleanedAfterTenants = [...tenantTables].filter(
      (table) => tables.indexOf(table) > tables.indexOf('tenants'),
    );

    expect(uncleaned).toEqual([]);
    expect(cleanedAfterTenants).toEqual([]);
  });

  it('cleans every foreign key child before the table it references', () => {
    const misordered = foreignKeys
      .filter(({ table, parentTable }) => {
        const child = tables.indexOf(table);
        const parent = tables.indexOf(parentTable);
        return (
          table !== parentTable && child > -1 && parent > -1 && child > parent
        );
      })
      .map(({ table, parentTable }) => `${table} -> ${parentTable}`);

    expect(misordered).toEqual([]);
  });
});
