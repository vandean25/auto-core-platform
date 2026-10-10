import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  confirmDocumentBrandTheme,
  createReadyDocumentBrandLogo,
  installFakeInvoiceArchiveStorage,
} from './invoice-branding-archive-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  cleanupTestTenantGraph,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('invoice branding commitment lock order (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenant: TestTenantResult;
  let authToken: string;
  let tenantId: string;
  let legalEntityId: string;
  let customerId: string;
  let catalogItemId: string;
  let vendorId: string;
  let siteId: string;
  const originalWriterFlag = process.env.INVOICE_BRANDING_WRITER_ENABLED;

  beforeAll(async () => {
    process.env.INVOICE_BRANDING_WRITER_ENABLED = 'true';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    installFakeInvoiceArchiveStorage(app);

    basePrisma = app.get(PrismaService);
    tenant = await createTestTenant(basePrisma, 'aut323-lock-order');
    tenantId = tenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), tenant);
    // sales_orders.order_number is globally unique in the database, so default counters collide with
    // other suites that share it. Start this tenant's counter at a per-run value (as finance.e2e does).
    const salesOrderStart = 100_000 + Math.floor(Math.random() * 800_000);
    await prisma.financeSettings.upsert({
      where: { tenant_id: tenantId },
      update: { next_sales_order_number: salesOrderStart },
      create: {
        tenant_id: tenantId,
        workshop_order_prefix: 'WO-2026-',
        next_sales_order_number: salesOrderStart,
      },
    });
    const { entity } = await seedReadySellerAndAccountingProfile(
      prisma,
      tenantId,
      { includeVehicleMargin: true },
    );
    legalEntityId = entity.id;
    customerId = (await seedInvoiceReadyCustomer(prisma, tenantId)).id;
    siteId = await resolveTestMainSiteId(prisma, tenantId);

    const catalogItem = await prisma.catalogItem.create({
      data: {
        sku: `AUT323-${randomUUID()}`,
        name: 'Concurrent commitment part',
        cost_price: 10,
        retail_price: 20,
      },
    });
    catalogItemId = catalogItem.id;
    const location = await prisma.storageLocation.create({
      data: {
        code: `AUT323-${randomUUID()}`,
        name: 'Concurrent commitment stock',
        type: 'warehouse',
        site_id: siteId,
      },
    });
    await prisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItemId,
        site_id: siteId,
        location_id: location.id,
        quantity_on_hand: 10,
      },
    });
    const vendor = await prisma.vendor.create({
      data: {
        name: 'Concurrent vehicle supplier',
        email: `aut323-${randomUUID()}@example.test`,
        account_number: `AUT323-${randomUUID()}`,
      },
    });
    vendorId = vendor.id;

    const logo = await createReadyDocumentBrandLogo(
      prisma,
      tenantId,
      legalEntityId,
      'concurrent-commit',
    );
    await confirmDocumentBrandTheme({
      app,
      authToken,
      legalEntityId,
      logoAssetId: logo.id,
      headerText: 'Concurrent commitment profile',
    });
  }, 60_000);

  afterAll(async () => {
    if (tenantId && basePrisma) {
      const tenantPrisma = createTenantAwarePrisma(basePrisma, tenantId);
      await tenantPrisma.invoiceBrandAssetReference.deleteMany({
        where: { tenant_id: tenantId },
      });
      await tenantPrisma.documentBrandProfile.deleteMany({});
      await tenantPrisma.documentBrandAsset.deleteMany({});
      await tenantPrisma.invoiceItem.deleteMany({});
      await tenantPrisma.invoice.deleteMany({});
      await tenantPrisma.salesOrderItem.deleteMany({});
      await tenantPrisma.salesOrder.deleteMany({});
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    if (app && basePrisma) await teardownTestApp(app, basePrisma);
    if (originalWriterFlag === undefined) {
      delete process.env.INVOICE_BRANDING_WRITER_ENABLED;
    } else {
      process.env.INVOICE_BRANDING_WRITER_ENABLED = originalWriterFlag;
    }
  });

  it(
    'commits sales, workshop, and vehicle-sale invoices concurrently without a lock cycle',
    async () => {
      const sourceInvoices = await createCommitmentSources();
      const api = request(app.getHttpServer());
      const [salesResponse, workshopResponse, vehicleSaleResponse] =
        await Promise.all([
          api
            .put(`/api/sales/invoices/${sourceInvoices.salesInvoiceId}/finalize`)
            .set('Authorization', `Bearer ${authToken}`)
            .expect(200),
          api
            .patch(`/api/invoices/${sourceInvoices.workshopInvoiceId}/issue`)
            .set('Authorization', `Bearer ${authToken}`)
            .expect(200),
          api
            .post(`/api/vehicle-sales/${sourceInvoices.vehicleSaleId}/finalize`)
            .set('Authorization', `Bearer ${authToken}`)
            .expect(201),
        ]);

      const invoices = [
        salesResponse.body,
        workshopResponse.body,
        vehicleSaleResponse.body.invoice,
      ];
      expect(invoices.map(({ status }) => status)).toEqual([
        'FINALIZED',
        'ISSUED',
        'FINALIZED',
      ]);
      expect(
        new Set(invoices.map(({ invoice_number }) => invoice_number)).size,
      ).toBe(3);

      const committedInvoices = await prisma.invoice.findMany({
        where: { id: { in: invoices.map(({ id }) => id) } },
        select: { snapshot: true },
      });
      expect(committedInvoices).toHaveLength(3);
      for (const { snapshot } of committedInvoices) {
        expect(snapshot).toMatchObject({
          template_version: 'invoice-brand-v1',
          branding: {
            profile_id: expect.any(String),
            logo: { asset_id: expect.any(String) },
          },
        });
      }
    },
    30_000,
  );

  async function createCommitmentSources() {
    const api = request(app.getHttpServer());
    const salesOrder = await api
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
            description: 'Concurrent sales part',
            quantity: 1,
            unit_price: 100,
            tax_rate: 20,
          },
        ],
      })
      .expect(201);
    await prisma.salesOrder.updateMany({
      where: { id: salesOrder.body.id, tenant_id: tenantId },
      data: { status: 'CONFIRMED' },
    });
    const salesInvoice = await api
      .post(`/api/sales-orders/${salesOrder.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'BMW',
        model: 'Workshop vehicle',
        year: 2021,
        vin: `AUT323${randomUUID().replaceAll('-', '').slice(0, 14)}`,
        customer_id: customerId,
      },
    });
    const workshopOrder = await api
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId: vehicle.id,
        odometer: 80_000,
        fuelLevel: 40,
      })
      .expect(201);
    const workshopTask = await api
      .post(`/api/workshop/orders/${workshopOrder.body.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Concurrent workshop labor' })
      .expect(201);
    await api
      .patch(
        `/api/workshop/orders/${workshopOrder.body.id}/tasks/${workshopTask.body.id}/line-items`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-323',
            description: 'Concurrent workshop labor',
            qty: 1,
            unitPrice: 80,
          },
        ],
      })
      .expect(200);
    await api
      .patch(
        `/api/workshop/orders/${workshopOrder.body.id}/tasks/${workshopTask.body.id}`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);
    const workshopInvoice = await api
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: workshopOrder.body.id })
      .expect(201);

    const purchase = await api
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: `AUT323${randomUUID().replaceAll('-', '').slice(0, 14)}`,
        make: 'Volkswagen',
        model: 'Concurrent stock vehicle',
        year: 2018,
        purchase_price: 10_000,
      })
      .expect(201);
    const receivedPurchase = await api
      .post(`/api/vehicle-purchases/${purchase.body.id}/receive`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    const vehicleSale = await api
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: receivedPurchase.body.vehicle_id,
        customer_id: customerId,
        sale_price: 12_000,
      })
      .expect(201);

    return {
      salesInvoiceId: salesInvoice.body.id as string,
      workshopInvoiceId: workshopInvoice.body.id as string,
      vehicleSaleId: vehicleSale.body.id as string,
    };
  }
});
