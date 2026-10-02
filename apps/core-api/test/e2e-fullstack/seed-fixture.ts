import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { createGlobalValidationPipe } from '../../src/common/index.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  type TestTenantResult,
} from '../tenant-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from '../invoice-snapshot-v2-test-utils.js';
import {
  confirmDocumentBrandTheme,
  createReadyDocumentBrandLogo,
} from '../invoice-branding-archive-test-utils.js';
import { installInMemoryInvoicePdfStorage } from './in-memory-invoice-pdf-storage.js';
import {
  E2E_FULLSTACK_CATALOG_NAME,
  E2E_FULLSTACK_CATALOG_SKU,
  E2E_FULLSTACK_CUSTOMER_LABEL,
  E2E_FULLSTACK_FIXTURE_RELATIVE_PATH,
  E2E_FULLSTACK_JWT_SECRET,
} from './constants.js';
import { teardownTestApp } from '../test-lifecycle.js';

export type E2eFullstackFixture = {
  authToken: string;
  tenantId: string;
  customerId: string;
  customerLabel: string;
  catalogSku: string;
  catalogName: string;
  catalogItemId: string;
};

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

async function truncateTransactionalTables(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "credit_note_items",
      "credit_notes",
      "credit_note_sequences",
      "inventory_transactions",
      "inventory_stocks",
      "storage_locations",
      "invoice_items",
      "invoices",
      "invoice_sequences",
      "sales_order_items",
      "sales_orders",
      "customers",
      "catalog_items"
    CASCADE;
  `);
}

async function seedBaseTenantData(
  app: INestApplication,
  prisma: PrismaService,
): Promise<{
  tenant: TestTenantResult;
  authToken: string;
  customerId: string;
  catalogItemId: string;
}> {
  await truncateTransactionalTables(prisma);

  const tenant = await createTestTenant(prisma, 'e2e-fullstack');
  const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
  const authToken = createTestAuthToken(app.get(AuthService), tenant);

  await seedReadySellerAndAccountingProfile(tenantPrisma, tenant.tenantId);
  const customer = await seedInvoiceReadyCustomer(tenantPrisma, tenant.tenantId);

  const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
  const catalogItem = await tenantPrisma.catalogItem.create({
    data: {
      sku: E2E_FULLSTACK_CATALOG_SKU,
      name: E2E_FULLSTACK_CATALOG_NAME,
      cost_price: 5,
      retail_price: 12,
      unit: 'pcs',
    },
  });
  const catalogItemId = catalogItem.id;

  const location = await tenantPrisma.storageLocation.create({
    data: {
      code: 'E2E-FS-WH',
      name: 'Fullstack warehouse',
      type: 'warehouse',
      site_id: siteId,
    },
  });

  await tenantPrisma.inventoryStock.create({
    data: {
      catalog_item_id: catalogItem.id,
      site_id: siteId,
      location_id: location.id,
      quantity_on_hand: 100,
    },
  });

  const legalEntityId = (
    await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
      select: { id: true },
    })
  ).id;

  const logo = await createReadyDocumentBrandLogo(
    tenantPrisma,
    tenant.tenantId,
    legalEntityId,
    'e2e-fullstack',
  );
  await confirmDocumentBrandTheme({
    app,
    authToken,
    legalEntityId,
    logoAssetId: logo.id,
    headerText: 'E2E fullstack branding profile',
  });

  return {
    tenant,
    authToken,
    customerId: customer.id,
    catalogItemId,
  };
}

async function createHarnessApp(): Promise<INestApplication> {
  process.env.NODE_ENV = 'test';
  process.env.TEST_JWT_SECRET = E2E_FULLSTACK_JWT_SECRET;
  process.env.INVOICE_BRANDING_WRITER_ENABLED = 'true';
  process.env.INVOICE_PDF_BUCKET = 'e2e-fullstack-invoice-pdf';

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createGlobalValidationPipe());
  await app.init();
  installInMemoryInvoicePdfStorage(app, { mockRenderer: false });
  return app;
}

export async function seedE2eFullstackFixture(
  fixturePath = resolve(repoRoot, E2E_FULLSTACK_FIXTURE_RELATIVE_PATH),
): Promise<E2eFullstackFixture> {
  const app = await createHarnessApp();
  const prisma = app.get(PrismaService);

  try {
    const { tenant, authToken, customerId, catalogItemId } =
      await seedBaseTenantData(app, prisma);

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const fixture: E2eFullstackFixture = {
      authToken,
      tenantId: tenant.tenantId,
      customerId,
      customerLabel: E2E_FULLSTACK_CUSTOMER_LABEL,
      catalogSku: E2E_FULLSTACK_CATALOG_SKU,
      catalogName: E2E_FULLSTACK_CATALOG_NAME,
      catalogItemId,
    };

    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    return fixture;
  } finally {
    await teardownTestApp(app, prisma);
  }
}
