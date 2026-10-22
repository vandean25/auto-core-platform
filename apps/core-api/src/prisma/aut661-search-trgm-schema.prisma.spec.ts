import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const schemaPath = join(process.cwd(), 'prisma', 'schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');

const TRGM_INDEX_COLUMNS: Record<string, readonly string[]> = {
  Customer: [
    'first_name',
    'last_name',
    'company_name',
    'email',
    'phone',
  ],
  Vehicle: ['plate', 'vin'],
  WorkshopOrder: ['order_number'],
  WorkshopEstimate: ['estimate_number'],
  Invoice: ['invoice_number'],
  CreditNote: ['credit_number'],
  VehicleSale: ['sale_number'],
  PurchaseInvoice: ['invoice_number', 'vendor_invoice_number'],
  PurchaseOrder: ['order_number'],
  SalesOrder: ['order_number'],
  CatalogItem: ['name', 'sku'],
  Vendor: ['name'],
  Employee: ['name'],
  LegalEntity: ['name'],
  Site: ['name'],
};

const MODEL_TO_TABLE: Record<string, string> = {
  Customer: 'customers',
  Vehicle: 'vehicles',
  WorkshopOrder: 'workshop_orders',
  WorkshopEstimate: 'workshop_estimates',
  Invoice: 'invoices',
  CreditNote: 'credit_notes',
  VehicleSale: 'vehicle_sales',
  PurchaseInvoice: 'purchase_invoices',
  PurchaseOrder: 'purchase_orders',
  SalesOrder: 'sales_orders',
  CatalogItem: 'catalog_items',
  Vendor: 'vendors',
  Employee: 'employees',
  LegalEntity: 'legal_entities',
  Site: 'sites',
};

function modelBlock(modelName: string): string {
  return schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}

function aut661MigrationSql(): string {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
  const folder = readdirSync(migrationsDir)
    .filter((name) => name.includes('aut661_search_trgm_indexes'))
    .sort()
    .at(-1);
  if (!folder) {
    return '';
  }
  return readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf8');
}

describe('AUT-661 search trigram schema (Prisma)', () => {
  for (const [model, columns] of Object.entries(TRGM_INDEX_COLUMNS)) {
    const table = MODEL_TO_TABLE[model];
    for (const column of columns) {
      const indexName = `${table}_${column}_trgm_idx`;
      it(`${model}.${column} has GIN gin_trgm_ops index map ${indexName}`, () => {
        const block = modelBlock(model);
        expect(block).toContain(`map: "${indexName}"`);
        expect(block).toMatch(
          new RegExp(
            `@@index\\(\\[${column}\\(ops: raw\\("gin_trgm_ops"\\)\\)\\], type: Gin`,
          ),
        );
      });
    }
  }

  it('migration SQL enables pg_trgm before GIN indexes and avoids CONCURRENTLY', () => {
    const sql = aut661MigrationSql();
    expect(sql.length).toBeGreaterThan(0);

    const extensionPos = sql.indexOf('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(extensionPos).toBeGreaterThanOrEqual(0);

    const firstGinPos = sql.search(/CREATE INDEX[^;]*USING gin/i);
    expect(firstGinPos).toBeGreaterThan(extensionPos);

    expect(sql.toUpperCase()).not.toContain('CONCURRENTLY');
  });
});
