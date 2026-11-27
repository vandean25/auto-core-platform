import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  type TestTenantResult,
} from './tenant-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const MIGRATION_SQL = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261126150000_aut1088_mandatory_legal_entity_payment_terms/migration.sql',
  ),
  'utf8',
);
const BACKFILL_BLOCK = MIGRATION_SQL.match(/DO \$\$[\s\S]+?END \$\$;/)?.[0];
const ALTER_STATEMENTS = MIGRATION_SQL.split('\n')
  .filter((line) => line.startsWith('ALTER TABLE'))
  .map((line) => line.replace(/;$/, ''));
const CONSTRAINT = 'legal_entities_payment_terms_days_non_negative';

describe('AUT-1088 mandatory LegalEntity payment terms migration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenantResult;
  let authToken: string;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    tenant = await createTestTenant(prisma, 'aut1088-mig');
    authToken = createTestAuthToken(app.get(AuthService), tenant);
  });

  afterAll(async () => {
    if (!app) return;
    try {
      if (tenant) await cleanupTestTenantGraph(prisma, tenant.tenantId);
    } finally {
      await teardownTestApp(app, prisma);
    }
  });

  async function runMigration() {
    if (!BACKFILL_BLOCK || ALTER_STATEMENTS.length !== 3) {
      throw new Error('Could not parse AUT-1088 migration.sql');
    }
    await prisma.$executeRawUnsafe(BACKFILL_BLOCK);
    for (const statement of ALTER_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
  }

  it('sets NULL legal entity payment terms to 14, enforces NOT NULL and >= 0, and leaves issued invoices byte-for-byte unchanged', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const { entity } = await seedReadySellerAndAccountingProfile(
      prisma,
      tenant.tenantId,
    );
    const customer = await seedInvoiceReadyCustomer(prisma, tenant.tenantId);
    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenant.tenantId,
        sku: `AUT1088-${Date.now()}`,
        name: 'Brake Pad',
        cost_price: 10,
        retail_price: 20,
      },
    });
    const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    const location = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        code: `LOC-${Date.now()}`,
        name: 'Warehouse',
        type: 'warehouse',
        site_id: siteId,
      },
    });
    await tenantPrisma.inventoryStock.create({
      data: {
        tenant_id: tenant.tenantId,
        catalog_item_id: catalogItem.id,
        site_id: siteId,
        location_id: location.id,
        quantity_on_hand: 10,
      },
    });

    // Golden: an invoice issued before the migration.
    const orderRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customer.id,
        items: [
          {
            catalog_item_id: catalogItem.id,
            description: 'Brake Pad',
            quantity: 1,
            unit_price: 100,
            tax_rate: 20,
          },
        ],
      })
      .expect(201);
    await tenantPrisma.salesOrder.updateMany({
      where: { id: orderRes.body.id },
      data: { status: 'CONFIRMED' },
    });
    const draft = await request(app.getHttpServer())
      .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    const finalized = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${draft.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const readInvoice = () =>
      tenantPrisma.invoice.findFirstOrThrow({
        where: { id: finalized.body.id },
        select: { snapshot: true, due_date: true, status: true },
      });
    const before = JSON.stringify(await readInvoice());

    // Recreate the pre-migration state: nullable column with a NULL row.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "legal_entities" DROP CONSTRAINT IF EXISTS "${CONSTRAINT}"`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "legal_entities" ALTER COLUMN "payment_terms_days" DROP NOT NULL`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "legal_entities" SET "payment_terms_days" = NULL WHERE "id" = '${entity.id}'`,
    );

    await runMigration();

    const migrated = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { id: entity.id },
    });
    expect(migrated.payment_terms_days).toBe(14);

    const column = await prisma.$queryRawUnsafe<{ is_nullable: string }[]>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'legal_entities' AND column_name = 'payment_terms_days'`,
    );
    expect(column[0].is_nullable).toBe('NO');
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "legal_entities" SET "payment_terms_days" = -1 WHERE "id" = '${entity.id}'`,
      ),
    ).rejects.toThrow();

    expect(JSON.stringify(await readInvoice())).toBe(before);
  });
});
