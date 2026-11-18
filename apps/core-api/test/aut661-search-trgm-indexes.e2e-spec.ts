import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const EXPECTED_TRGM_INDEXES = [
  'customers_first_name_trgm_idx',
  'customers_last_name_trgm_idx',
  'customers_company_name_trgm_idx',
  'customers_email_trgm_idx',
  'customers_phone_trgm_idx',
  'vehicles_plate_trgm_idx',
  'vehicles_vin_trgm_idx',
  'workshop_orders_order_number_trgm_idx',
  'workshop_estimates_estimate_number_trgm_idx',
  'invoices_invoice_number_trgm_idx',
  'credit_notes_credit_number_trgm_idx',
  'vehicle_sales_sale_number_trgm_idx',
  'purchase_invoices_invoice_number_trgm_idx',
  'purchase_invoices_vendor_invoice_number_trgm_idx',
  'purchase_orders_order_number_trgm_idx',
  'sales_orders_order_number_trgm_idx',
  'catalog_items_name_trgm_idx',
  'catalog_items_sku_trgm_idx',
  'vendors_name_trgm_idx',
  'vendors_email_trgm_idx',
  'vendors_account_number_trgm_idx',
  'employees_name_trgm_idx',
  'users_email_trgm_idx',
  'users_first_name_trgm_idx',
  'users_last_name_trgm_idx',
  'legal_entities_name_trgm_idx',
  'legal_entities_tax_number_trgm_idx',
  'legal_entities_registration_number_trgm_idx',
  'sites_name_trgm_idx',
  'labor_operations_code_trgm_idx',
  'labor_operations_description_trgm_idx',
  'external_id_mappings_external_id_trgm_idx',
] as const;

type TrgmExplainProbe = {
  table: string;
  column: string;
  index: (typeof EXPECTED_TRGM_INDEXES)[number];
};

const SEARCHED_TEXT_COLUMN_PROBES: readonly TrgmExplainProbe[] = [
  { table: 'customers', column: 'first_name', index: 'customers_first_name_trgm_idx' },
  { table: 'customers', column: 'last_name', index: 'customers_last_name_trgm_idx' },
  { table: 'customers', column: 'company_name', index: 'customers_company_name_trgm_idx' },
  { table: 'customers', column: 'email', index: 'customers_email_trgm_idx' },
  { table: 'customers', column: 'phone', index: 'customers_phone_trgm_idx' },
  { table: 'vehicles', column: 'plate', index: 'vehicles_plate_trgm_idx' },
  { table: 'vehicles', column: 'vin', index: 'vehicles_vin_trgm_idx' },
  { table: 'workshop_orders', column: 'order_number', index: 'workshop_orders_order_number_trgm_idx' },
  { table: 'invoices', column: 'invoice_number', index: 'invoices_invoice_number_trgm_idx' },
  { table: 'catalog_items', column: 'name', index: 'catalog_items_name_trgm_idx' },
  { table: 'catalog_items', column: 'sku', index: 'catalog_items_sku_trgm_idx' },
];

type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: PlanNode[];
};

function collectPlanNodes(root: PlanNode): {
  nodeTypes: string[];
  indexNames: string[];
} {
  const nodeTypes: string[] = [root['Node Type']];
  const indexNames: string[] = root['Index Name'] ? [root['Index Name']] : [];
  for (const child of root.Plans ?? []) {
    const nested = collectPlanNodes(child);
    nodeTypes.push(...nested.nodeTypes);
    indexNames.push(...nested.indexNames);
  }
  return { nodeTypes, indexNames };
}

describe('AUT-661 pg_trgm and GIN trigram indexes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenantResult | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    if (app) {
      try {
        if (tenant) {
          await cleanupTestTenantGraph(prisma, tenant.tenantId);
        }
      } finally {
        await teardownTestApp(app, prisma);
      }
    }
  });

  it('has pg_trgm extension installed', async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>(
      Prisma.sql`SELECT 1 AS ok FROM pg_extension WHERE extname = 'pg_trgm'`,
    );
    expect(rows).toEqual([{ ok: 1 }]);
  });

  it('has expected GIN gin_trgm_ops indexes in pg_indexes', async () => {
    const rows = await prisma.$queryRaw<
      { indexname: string; indexdef: string }[]
    >(
      Prisma.sql`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (${Prisma.join([...EXPECTED_TRGM_INDEXES])})
      `,
    );

    expect(rows).toHaveLength(EXPECTED_TRGM_INDEXES.length);

    for (const row of rows) {
      expect(row.indexdef.toLowerCase()).toContain('using gin');
      expect(row.indexdef).toContain('gin_trgm_ops');
    }

    const names = rows.map((row) => row.indexname).sort();
    expect(names).toEqual([...EXPECTED_TRGM_INDEXES].sort());
  });

  it('uses *_trgm_idx without Seq Scan in EXPLAIN after seeding large tables and VACUUM ANALYZE', async () => {
    tenant = await createTestTenant(prisma, 'trgm-explain');
    const tenantId = tenant.tenantId;
    const rowCount = 2500;
    const suffix = `${Date.now()}`.slice(-6);

    const anchorCustomerId = `trgm-cust-0-${suffix}`;
    const anchorVehicleId = `trgm-veh-0-${suffix}`;

    await prisma.$executeRaw`
      INSERT INTO "customers" ("id", "tenant_id", "first_name", "last_name", "company_name", "email", "phone", "updatedAt")
      SELECT
        ${`trgm-cust-${suffix}-`} || g::text,
        ${tenantId},
        CASE WHEN g = 1 THEN 'NeedleTrgmFirst' ELSE 'Vorname' || g::text END,
        CASE WHEN g = 1 THEN 'NeedleTrgmLast' ELSE 'Nachname' || g::text END,
        CASE WHEN g = 1 THEN 'NeedleTrgmGmbH' ELSE 'Firma' || g::text END,
        CASE WHEN g = 1 THEN 'needle.trgm@example.test' ELSE 'user' || g::text || '@example.test' END,
        CASE WHEN g = 1 THEN '+436609998877' ELSE '+43660' || (100000 + g)::text END,
        NOW()
      FROM generate_series(1, ${rowCount}) AS g
    `;

    await prisma.$executeRaw`
      INSERT INTO "customers" ("id", "tenant_id", "first_name", "last_name", "updatedAt")
      VALUES (${anchorCustomerId}, ${tenantId}, 'Anchor', 'Customer', NOW())
    `;

    await prisma.$executeRaw`
      INSERT INTO "vehicles" ("id", "tenant_id", "make", "model", "year", "plate", "vin", "updatedAt")
      SELECT
        ${`trgm-veh-${suffix}-`} || g::text,
        ${tenantId},
        'Make' || g::text,
        'Model' || g::text,
        2020,
        CASE WHEN g = 1 THEN 'W-NEEDLE-1' ELSE 'W-' || (10000 + g)::text || 'A' END,
        CASE WHEN g = 1 THEN 'WVWZZZNEEDLE00001' ELSE 'WVWZZZ1KZAW' || LPAD(g::text, 6, '0') END,
        NOW()
      FROM generate_series(1, ${rowCount}) AS g
    `;

    await prisma.$executeRaw`
      INSERT INTO "vehicles" ("id", "tenant_id", "make", "model", "year", "updatedAt")
      VALUES (${anchorVehicleId}, ${tenantId}, 'Anchor', 'Vehicle', 2020, NOW())
    `;

    await prisma.$executeRaw`
      INSERT INTO "workshop_orders" ("id", "tenant_id", "vehicle_id", "odometer", "fuel_level", "order_number", "updatedAt")
      SELECT
        ${`trgm-wo-${suffix}-`} || g::text,
        ${tenantId},
        ${anchorVehicleId},
        1000,
        50,
        CASE WHEN g = 1 THEN 'WO-NEEDLE-001' ELSE 'WO-BULK-' || g::text END,
        NOW()
      FROM generate_series(1, ${rowCount}) AS g
    `;

    await prisma.$executeRaw`
      INSERT INTO "invoices" ("id", "tenant_id", "customer_id", "invoice_number", "status", "due_date", "total_net", "total_tax", "total_gross", "updatedAt")
      SELECT
        ${`trgm-inv-${suffix}-`} || g::text,
        ${tenantId},
        ${anchorCustomerId},
        CASE WHEN g = 1 THEN 'RE-NEEDLE-001' ELSE 'RE-BULK-' || g::text END,
        'ISSUED'::"InvoiceStatus",
        NOW(),
        10,
        2,
        12,
        NOW()
      FROM generate_series(1, ${rowCount}) AS g
    `;

    await prisma.$executeRaw`
      INSERT INTO "catalog_items" ("id", "tenant_id", "sku", "name", "retail_price", "updatedAt")
      SELECT
        ${`trgm-part-${suffix}-`} || g::text,
        ${tenantId},
        CASE WHEN g = 1 THEN 'SKU-NEEDLE-001' ELSE 'SKU-BULK-' || g::text END,
        CASE WHEN g = 1 THEN 'NeedleTrgmPart' ELSE 'Part-' || g::text END,
        10,
        NOW()
      FROM generate_series(1, ${rowCount}) AS g
    `;

    for (const table of [
      'customers',
      'vehicles',
      'workshop_orders',
      'invoices',
      'catalog_items',
    ]) {
      await prisma.$executeRawUnsafe(`VACUUM ANALYZE "${table}"`);
    }

    for (const probe of SEARCHED_TEXT_COLUMN_PROBES) {
      const explainRows = await prisma.$queryRawUnsafe<
        Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>
      >(
        `EXPLAIN (FORMAT JSON) SELECT "id" FROM "${probe.table}" WHERE "tenant_id" = $1 AND "${probe.column}" ILIKE '%NEEDLE%' LIMIT 5`,
        tenantId,
      );
      const { nodeTypes, indexNames } = collectPlanNodes(
        explainRows[0]['QUERY PLAN'][0].Plan,
      );
      expect(indexNames).toContain(probe.index);
      expect(nodeTypes).not.toContain('Seq Scan');
    }
  });
});
