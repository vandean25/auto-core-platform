import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
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
  'employees_name_trgm_idx',
  'legal_entities_name_trgm_idx',
  'sites_name_trgm_idx',
] as const;

describe('AUT-661 pg_trgm and GIN trigram indexes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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
      await teardownTestApp(app, prisma);
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
});
