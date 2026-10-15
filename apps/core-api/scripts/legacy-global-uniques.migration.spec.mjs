import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const LEGACY_GLOBAL_UNIQUE_INDEXES = [
  'revenue_groups_name_key',
  'catalog_items_sku_key',
  'labor_categories_name_key',
  'labor_operations_code_key',
  'inventory_stocks_catalog_item_id_key',
  'inventory_stocks_catalog_item_id_location_id_key',
  'invoices_invoice_number_key',
  'invoices_sales_order_id_key',
  'invoices_workshop_order_id_key',
  'purchase_invoices_invoice_number_key',
  'purchase_orders_order_number_key',
  'sales_orders_order_number_key',
  'workshop_orders_order_number_key',
];

const migrationPath = join(
  import.meta.dirname,
  '../prisma/migrations/20261015180000_aut550_drop_legacy_global_uniques/migration.sql',
);

test('AUT-550 migration drops every audited legacy global unique index', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  for (const indexName of LEGACY_GLOBAL_UNIQUE_INDEXES) {
    assert.match(
      sql,
      new RegExp(`DROP INDEX IF EXISTS "${indexName}"`),
      `expected DROP INDEX for ${indexName}`,
    );
  }
});

test('AUT-550 migration is idempotent (IF NOT EXISTS / IF EXISTS)', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  assert.ok(
    sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS'),
    'tenant-scoped indexes must use IF NOT EXISTS',
  );
  assert.ok(
    sql.includes('DROP INDEX IF EXISTS'),
    'legacy drops must use IF EXISTS',
  );
});
