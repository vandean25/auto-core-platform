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
  seedTestTenantMember,
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
  E2E_FULLSTACK_MECHANIC_NAME,
  E2E_FULLSTACK_VEHICLE_BUYER_FIRST,
  E2E_FULLSTACK_VEHICLE_BUYER_LAST,
  E2E_FULLSTACK_VENDOR_NAME,
  E2E_FULLSTACK_WORKSHOP_ORDER_NUMBER,
  E2E_FULLSTACK_WORKSHOP_TASK_TITLE,
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
  vendorId: string;
  vendorName: string;
  vehicleBuyerId: string;
  vehicleBuyerLabel: string;
  mechanicAuthToken: string;
  mechanicEmployeeId: string;
  mechanicEmployeeName: string;
  workshopOrderId: string;
  workshopOrderNumber: string;
  workshopTaskId: string;
  workshopTaskTitle: string;
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
  vendorId: string;
  vehicleBuyerId: string;
  vehicleBuyerLabel: string;
  mechanicAuthToken: string;
  mechanicEmployeeId: string;
  mechanicEmployeeName: string;
  workshopOrderId: string;
  workshopOrderNumber: string;
  workshopTaskId: string;
  workshopTaskTitle: string;
}> {
  await truncateTransactionalTables(prisma);

  const tenant = await createTestTenant(prisma, 'e2e-fullstack');
  const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
  const authToken = createTestAuthToken(app.get(AuthService), tenant);

  await seedReadySellerAndAccountingProfile(tenantPrisma, tenant.tenantId, {
    includeVehicleMargin: true,
  });
  const customer = await seedInvoiceReadyCustomer(tenantPrisma, tenant.tenantId);

  const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);

  const vendor = await tenantPrisma.vendor.create({
    data: {
      tenant_id: tenant.tenantId,
      name: E2E_FULLSTACK_VENDOR_NAME,
      email: 'e2e-fullstack-vendor@auto.core.test',
      account_number: 'E2E-FS-VND',
    },
  });

  const vehicleBuyer = await tenantPrisma.customer.create({
    data: {
      tenant_id: tenant.tenantId,
      first_name: E2E_FULLSTACK_VEHICLE_BUYER_FIRST,
      last_name: E2E_FULLSTACK_VEHICLE_BUYER_LAST,
      email: 'e2e-fullstack-vehicle-buyer@auto.core.test',
      type: 'PRIVATE',
      address_street: 'Testgasse 2',
      address_zip: '1020',
      address_city: 'Wien',
      address_country: 'AT',
    },
  });

  const authService = app.get(AuthService);
  const mechanicFirebaseUid = `e2e-fullstack-mechanic-${tenant.tenantId}`;
  const mechanicUser = await prisma.user.create({
    data: {
      firebaseUid: mechanicFirebaseUid,
      email: `e2e-fullstack-mechanic-${tenant.tenantId}@auto.core.test`,
    },
  });
  await seedTestTenantMember(prisma, {
    tenantId: tenant.tenantId,
    userId: mechanicUser.id,
    role: 'TECH',
  });
  await tenantPrisma.siteMembership.create({
    data: {
      tenant_id: tenant.tenantId,
      user_id: mechanicUser.id,
      site_id: siteId,
      is_active: true,
    },
  });
  await prisma.user.update({
    where: { id: mechanicUser.id },
    data: {
      active_tenant_id: tenant.tenantId,
      active_site_id: siteId,
    },
  });
  const mechanicEmployee = await tenantPrisma.employee.create({
    data: {
      tenant_id: tenant.tenantId,
      name: E2E_FULLSTACK_MECHANIC_NAME,
      role: 'MECHANIC',
      is_active: true,
      user_id: mechanicUser.id,
    },
  });
  const mechanicAuthToken = authService.createTestToken({
    sub: mechanicFirebaseUid,
    email: mechanicUser.email,
    tenantId: tenant.tenantId,
    role: 'TECH',
  });

  const workshopCustomer = await tenantPrisma.customer.create({
    data: {
      tenant_id: tenant.tenantId,
      first_name: 'Werkstatt',
      last_name: 'Kundin E2E',
      email: 'e2e-fullstack-workshop-customer@auto.core.test',
      type: 'PRIVATE',
    },
  });
  const workshopVehicle = await tenantPrisma.vehicle.create({
    data: {
      tenant_id: tenant.tenantId,
      make: 'Skoda',
      model: 'Fabia',
      year: 2019,
      vin: 'WVWE2EFULLSTKW001',
      plate: 'W-E2EFS1',
      plate_normalized: 'WE2EFS1',
      customer_id: workshopCustomer.id,
    },
  });
  const workshopOrder = await tenantPrisma.workshopOrder.create({
    data: {
      tenant_id: tenant.tenantId,
      site_id: siteId,
      order_number: E2E_FULLSTACK_WORKSHOP_ORDER_NUMBER,
      customer_id: workshopCustomer.id,
      vehicle_id: workshopVehicle.id,
      odometer: 95_000,
      fuel_level: 40,
      status: 'INTAKE',
    },
  });
  const workshopTask = await tenantPrisma.workshopTask.create({
    data: {
      tenant_id: tenant.tenantId,
      workshop_order_id: workshopOrder.id,
      title: E2E_FULLSTACK_WORKSHOP_TASK_TITLE,
      sequence: 1,
      status: 'NOT_STARTED',
    },
  });
  const catalogItem = await tenantPrisma.catalogItem.create({
    data: {
      tenant_id: tenant.tenantId,
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
      tenant_id: tenant.tenantId,
      code: 'E2E-FS-WH',
      name: 'Fullstack warehouse',
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
    vendorId: vendor.id,
    vehicleBuyerId: vehicleBuyer.id,
    vehicleBuyerLabel: `${E2E_FULLSTACK_VEHICLE_BUYER_FIRST} ${E2E_FULLSTACK_VEHICLE_BUYER_LAST}`,
    mechanicAuthToken,
    mechanicEmployeeId: mechanicEmployee.id,
    mechanicEmployeeName: E2E_FULLSTACK_MECHANIC_NAME,
    workshopOrderId: workshopOrder.id,
    workshopOrderNumber: E2E_FULLSTACK_WORKSHOP_ORDER_NUMBER,
    workshopTaskId: workshopTask.id,
    workshopTaskTitle: E2E_FULLSTACK_WORKSHOP_TASK_TITLE,
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
    const seeded = await seedBaseTenantData(app, prisma);

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${seeded.authToken}`)
      .expect(200);

    const fixture: E2eFullstackFixture = {
      authToken: seeded.authToken,
      tenantId: seeded.tenant.tenantId,
      customerId: seeded.customerId,
      customerLabel: E2E_FULLSTACK_CUSTOMER_LABEL,
      catalogSku: E2E_FULLSTACK_CATALOG_SKU,
      catalogName: E2E_FULLSTACK_CATALOG_NAME,
      catalogItemId: seeded.catalogItemId,
      vendorId: seeded.vendorId,
      vendorName: E2E_FULLSTACK_VENDOR_NAME,
      vehicleBuyerId: seeded.vehicleBuyerId,
      vehicleBuyerLabel: seeded.vehicleBuyerLabel,
      mechanicAuthToken: seeded.mechanicAuthToken,
      mechanicEmployeeId: seeded.mechanicEmployeeId,
      mechanicEmployeeName: seeded.mechanicEmployeeName,
      workshopOrderId: seeded.workshopOrderId,
      workshopOrderNumber: seeded.workshopOrderNumber,
      workshopTaskId: seeded.workshopTaskId,
      workshopTaskTitle: seeded.workshopTaskTitle,
    };

    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    return fixture;
  } finally {
    await teardownTestApp(app, prisma);
  }
}
