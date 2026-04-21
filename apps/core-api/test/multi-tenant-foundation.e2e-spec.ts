import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Multi-tenant foundation schema', () => {
  it('defines Tenant with the ADR-0013 contract and keeps Tenant out of realtime sync', () => {
    const schema = readFileSync(
      join(process.cwd(), 'prisma', 'schema.prisma'),
      'utf8',
    );
    const realtimeExtension = readFileSync(
      join(
        process.cwd(),
        'src',
        'prisma',
        'prisma-dashboard-realtime.extension.ts',
      ),
      'utf8',
    );

    expect(schema).toContain('model Tenant {');
    expect(schema).toContain('slug       String     @unique');
    expect(schema).toContain('plan       TenantPlan @default(STANDARD)');
    expect(schema).toContain('is_active  Boolean    @default(true)');
    expect(schema).toContain('enum TenantPlan {');
    expect(schema).toContain('STANDARD');
    expect(schema).toContain('PREMIUM');
    expect(schema).toContain('ENTERPRISE');
    expect(realtimeExtension).not.toMatch(/TENANT:\s*true/);
  });

  it('adds tenant_id, tenant relation, and tenant index to all Phase 1 domain models', () => {
    const schema = readFileSync(
      join(process.cwd(), 'prisma', 'schema.prisma'),
      'utf8',
    );
    const requiredModels = [
      'CatalogItem',
      'InventoryStock',
      'InventoryTransaction',
      'StorageLocation',
      'PurchaseOrder',
      'PurchaseOrderItem',
      'PurchaseInvoice',
      'PurchaseInvoiceLine',
      'SalesOrder',
      'SalesOrderItem',
      'Invoice',
      'InvoiceItem',
      'InvoiceSequence',
      'WorkshopOrder',
      'WorkshopTask',
      'WorkshopTaskLineItem',
      'LaborCategory',
      'LaborOperation',
      'Customer',
      'Vehicle',
      'Brand',
      'Vendor',
      'FinanceSettings',
      'RevenueGroup',
    ];

    for (const model of requiredModels) {
      const modelBlock =
        schema.match(
          new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm'),
        )?.[0] ?? '';
      expect(modelBlock).toContain('tenant_id');
      expect(modelBlock).toContain('tenant');
      expect(modelBlock).toContain('@@index([tenant_id])');
    }
  });

  it('promotes tenant-scoped uniqueness to composite constraints', () => {
    const schema = readFileSync(
      join(process.cwd(), 'prisma', 'schema.prisma'),
      'utf8',
    );

    expect(schema).toContain('@@unique([tenant_id, name]) // tenant-scoped');
    expect(schema).toContain('@@unique([tenant_id, sku]) // tenant-scoped');
    expect(schema).toContain('@@unique([tenant_id, code]) // tenant-scoped');
    expect(schema).toContain(
      '@@unique([tenant_id, catalog_item_id, location_id]) // tenant-scoped',
    );
    expect(schema).toContain(
      '@@unique([tenant_id, order_number]) // tenant-scoped',
    );
    expect(schema).toContain('@@unique([tenant_id, email]) // tenant-scoped');
    expect(schema).toContain('@@unique([tenant_id, vin]) // tenant-scoped');
    expect(schema).toContain(
      '@@unique([tenant_id, invoice_number]) // tenant-scoped',
    );
    expect(schema).toContain(
      '@@unique([tenant_id, sales_order_id]) // tenant-scoped',
    );
    expect(schema).toContain(
      '@@unique([tenant_id, workshop_order_id]) // tenant-scoped',
    );
    expect(schema).toContain('@@unique([tenant_id, year]) // tenant-scoped');
    expect(schema).toContain('@@unique([tenant_id]) // tenant-scoped');
    expect(schema).not.toMatch(
      /model CatalogItem \{[\s\S]*sku\s+String\s+@unique/m,
    );
    expect(schema).not.toMatch(
      /model SalesOrder \{[\s\S]*order_number\s+String\s+@unique/m,
    );
    expect(schema).not.toMatch(
      /model Invoice \{[\s\S]*invoice_number\s+String\?\s+@unique/m,
    );
  });
});
