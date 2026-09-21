import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SiteService } from '../src/site/site.service.js';
import { FIXED_SOURCE_CATEGORY_KEYS } from '../src/finance/accounting-profile/accounting-profile.types.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  runWithTenantContext,
  type TestTenantResult,
} from './tenant-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

function vin(tag: string) {
  return `WVW${tag
    .replace(/[^A-Z0-9]/gi, 'X')
    .toUpperCase()
    .padEnd(14, '0')
    .slice(0, 14)}`;
}

describe('Legal invoicing snapshot v2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: PrismaService;
  let authService: AuthService;
  let siteService: SiteService;
  let tenant: TestTenantResult;
  let authToken: string;
  let siteId: string;
  let customerId: string;
  let catalogItemId: string;
  let vehicleId: string;
  let vendorId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
    siteService = app.get<SiteService>(SiteService);

    tenant = await createTestTenant(prisma, 'aut298');
    tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    authToken = createTestAuthToken(authService, tenant);
    siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "inventory_transactions",
        "inventory_stocks",
        "invoice_items",
        "invoices",
        "invoice_sequences",
        "sales_order_items",
        "sales_orders"
      CASCADE;
    `);

    await seedReadySellerAndAccountingProfile(prisma, tenant.tenantId, {
      includeVehicleMargin: true,
    });
    const customer = await seedInvoiceReadyCustomer(prisma, tenant.tenantId);
    customerId = customer.id;

    const vendor = await tenantPrisma.vendor.create({
      data: {
        name: 'Used Cars GmbH',
        email: `vendor-${Date.now()}@cars.test`,
        account_number: 'VC-001',
      },
    });
    vendorId = vendor.id;

    const vehicle = await tenantPrisma.vehicle.create({
      data: {
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
        vin: vin(`AUT298-${Date.now()}`),
        customer_id: customerId,
      },
    });
    vehicleId = vehicle.id;

    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        sku: `AUT298-${Date.now()}`,
        name: 'Brake Pad',
        cost_price: 10,
        retail_price: 20,
      },
    });
    catalogItemId = catalogItem.id;

    const location = await tenantPrisma.storageLocation.create({
      data: {
        code: `LOC-${Date.now()}`,
        name: 'Warehouse',
        type: 'warehouse',
        site_id: siteId,
      },
    });
    await tenantPrisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItemId,
        site_id: siteId,
        location_id: location.id,
        quantity_on_hand: 100,
      },
    });
  });

  afterAll(async () => {
    // Free globally-unique workshop order numbers for later e2e suites.
    await tenantPrisma.invoiceItem.deleteMany();
    await tenantPrisma.invoice.deleteMany();
    await tenantPrisma.invoiceSequence.deleteMany();
    await tenantPrisma.salesOrderItem.deleteMany();
    await tenantPrisma.salesOrder.deleteMany();
    await tenantPrisma.vehicleLedgerEntry.deleteMany();
    await tenantPrisma.vehicleSale.deleteMany();
    await tenantPrisma.vehiclePurchase.deleteMany();
    await tenantPrisma.workshopTaskLineItem.deleteMany();
    await tenantPrisma.workshopTask.deleteMany();
    await tenantPrisma.workshopOrder.deleteMany();
    await teardownTestApp(app, prisma);
  });

  async function createSalesOrderInvoice() {
    const orderRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
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

    const invoiceRes = await request(app.getHttpServer())
      .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    return invoiceRes.body;
  }

  async function createCompletedWorkshopDraftInvoice() {
    const orderRes = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 120000,
        fuelLevel: 40,
        notes: 'Brake noise',
      })
      .expect(201);

    const taskRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderRes.body.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Replace brake pads' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(
        `/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}/line-items`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-001',
            description: 'Brake labor',
            qty: 2,
            unitPrice: 80,
          },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    const invoiceRes = await request(app.getHttpServer())
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderRes.body.id })
      .expect(201);

    return { orderId: orderRes.body.id, invoice: invoiceRes.body };
  }

  async function createSecondSite() {
    const legalEntity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const user = await tenantPrisma.user.findFirstOrThrow({
      where: { email: tenant.email },
    });
    const site = await runWithTenantContext(tenant.tenantId, () =>
      siteService.createSite({
        legalEntityId: legalEntity.id,
        code: 'SECOND',
        name: 'Second Site',
      }),
    );
    await runWithTenantContext(tenant.tenantId, () =>
      siteService.addSiteMembership(site.id, { userId: user.id }),
    );
    return site;
  }

  it('LI-02/LI-03: sales finalize writes v2 seller snapshot from source site', async () => {
    const draft = await createSalesOrderInvoice();

    const finalizeRes = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${draft.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const invoice = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: finalizeRes.body.id },
      include: { items: true },
    });

    expect(invoice.site_id).toBe(siteId);
    expect(invoice.legal_entity_id).toBeTruthy();
    expect(invoice.snapshot).toMatchObject({
      schema_version: 2,
      site_id: siteId,
      seller: {
        name: expect.stringContaining('GmbH'),
      },
    });
    expect(invoice.items[0].accounting_snapshot).toBeTruthy();
  });

  it('LI-03: rejects source-less sales invoice finalization', async () => {
    const invoice = await tenantPrisma.invoice.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        status: 'DRAFT',
        date: new Date(),
        due_date: new Date(),
        total_net: 10,
        total_tax: 2,
        total_gross: 12,
        items: {
          create: {
            tenant_id: tenant.tenantId,
            description: 'Legacy draft',
            quantity: 1,
            unit_price: 10,
            tax_rate: 20,
            line_total: 10,
          },
        },
      },
    });

    const response = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${invoice.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);

    expect(response.body.code ?? response.body.message).toBeTruthy();
  });

  it('LI-04: master-data edits after issuance do not change stored snapshot', async () => {
    const draft = await createSalesOrderInvoice();

    await request(app.getHttpServer())
      .put(`/api/sales/invoices/${draft.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const before = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: draft.id },
    });

    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });

    await tenantPrisma.legalEntity.update({
      where: { id: entity.id },
      data: {
        name: 'Changed Seller Name GmbH',
        payment_terms_text: 'Changed terms',
      },
    });
    await tenantPrisma.customer.update({
      where: { id: customerId },
      data: { first_name: 'Changed' },
    });

    const after = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: draft.id },
    });

    expect(after.snapshot).toEqual(before.snapshot);
    expect((after.snapshot as { seller: { name: string } }).seller.name).not.toBe(
      'Changed Seller Name GmbH',
    );
  });

  it('LI-03: returns ACCOUNTING_MAPPING_INCOMPLETE when mapping is missing', async () => {
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    await tenantPrisma.legalEntityAccountingProfile.update({
      where: {
        tenant_id_legal_entity_id: {
          tenant_id: tenant.tenantId,
          legal_entity_id: entity.id,
        },
      },
      data: { mapping_rules: [] },
    });

    const draft = await createSalesOrderInvoice();

    const response = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${draft.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(422);

    expect(response.body.code).toBe('ACCOUNTING_MAPPING_INCOMPLETE');

    await seedReadySellerAndAccountingProfile(prisma, tenant.tenantId, {
      includeVehicleMargin: true,
    });
  });

  it('LI-02: workshop issue writes v2 seller snapshot from source site', async () => {
    const { invoice } = await createCompletedWorkshopDraftInvoice();

    const issueRes = await request(app.getHttpServer())
      .patch(`/api/invoices/${invoice.id}/issue`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const stored = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: issueRes.body.id },
      include: { items: true },
    });

    expect(stored.status).toBe('ISSUED');
    expect(stored.site_id).toBe(siteId);
    expect(stored.snapshot).toMatchObject({
      schema_version: 2,
      site_id: siteId,
      seller: {
        name: expect.stringContaining('GmbH'),
      },
    });
    expect(stored.items[0].accounting_snapshot).toMatchObject({
      sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.LABOR,
    });
  });

  it('LI-02: vehicle sale finalize writes v2 seller snapshot and margin block', async () => {
    const purchaseRes = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: vin(`SALE-${Date.now()}`),
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
        purchase_price: 10000,
      })
      .expect(201);

    const received = await request(app.getHttpServer())
      .post(`/api/vehicle-purchases/${purchaseRes.body.id}/receive`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const saleRes = await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: received.body.vehicle_id,
        customer_id: customerId,
        sale_price: 12000,
      })
      .expect(201);

    const finalized = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const stored = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: finalized.body.invoice.id },
      include: { items: true },
    });

    expect(stored.site_id).toBe(siteId);
    expect(stored.snapshot).toMatchObject({
      schema_version: 2,
      site_id: siteId,
      margin: expect.objectContaining({
        calculation_profile: 'vehicle-margin-v1',
      }),
    });
    expect(stored.items[0].accounting_snapshot).toMatchObject({
      sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.VEHICLE_MARGIN,
    });
  });

  it('LI-02: active site switch does not relabel a workshop draft seller on issue', async () => {
    const secondSite = await createSecondSite();
    const { invoice } = await createCompletedWorkshopDraftInvoice();

    await request(app.getHttpServer())
      .patch('/api/me/active-site')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ siteId: secondSite.id })
      .expect(200);

    const issueRes = await request(app.getHttpServer())
      .patch(`/api/invoices/${invoice.id}/issue`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(issueRes.body.site_id).toBe(siteId);
    expect(issueRes.body.snapshot).toMatchObject({
      schema_version: 2,
      site_id: siteId,
    });

    await request(app.getHttpServer())
      .patch('/api/me/active-site')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ siteId: siteId })
      .expect(200);
  });

  it('LI-03: rejects sales finalize for workshop-sourced drafts', async () => {
    const { invoice } = await createCompletedWorkshopDraftInvoice();

    const response = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${invoice.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);

    expect(response.body.code).toBe('SOURCE_DOCUMENT_REQUIRED');
  });

  it('AUT-299: blocks sales finalize when seller identity is incomplete', async () => {
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    await tenantPrisma.legalEntity.update({
      where: { id: entity.id },
      data: { vat_id: null, tax_number: null },
    });

    const draft = await createSalesOrderInvoice();
    const sequenceBefore = await tenantPrisma.invoiceSequence.findMany();
    const stockBefore = await tenantPrisma.inventoryStock.findFirstOrThrow({
      where: { catalog_item_id: catalogItemId, site_id: siteId },
    });
    const order = await tenantPrisma.salesOrder.findFirstOrThrow({
      where: { id: draft.sales_order_id! },
    });

    const response = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${draft.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(422);

    expect(response.body.code).toBe('SELLER_IDENTITY_INCOMPLETE');
    expect(response.body.missingFields).toContain('vat_id');

    const sequenceAfter = await tenantPrisma.invoiceSequence.findMany();
    expect(sequenceAfter).toEqual(sequenceBefore);

    const invoiceAfter = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: draft.id },
    });
    expect(invoiceAfter.status).toBe('DRAFT');
    expect(invoiceAfter.invoice_number).toBeNull();

    const stockAfter = await tenantPrisma.inventoryStock.findFirstOrThrow({
      where: { catalog_item_id: catalogItemId, site_id: siteId },
    });
    expect(stockAfter.quantity_on_hand).toEqual(stockBefore.quantity_on_hand);

    const orderAfter = await tenantPrisma.salesOrder.findFirstOrThrow({
      where: { id: order.id },
    });
    expect(orderAfter.status).toBe(order.status);

    await seedReadySellerAndAccountingProfile(prisma, tenant.tenantId, {
      includeVehicleMargin: true,
    });
  });

  it('AUT-299: allows sales finalize after seller identity is complete', async () => {
    await seedReadySellerAndAccountingProfile(prisma, tenant.tenantId, {
      includeVehicleMargin: true,
    });

    const draft = await createSalesOrderInvoice();

    const finalizeRes = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${draft.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(finalizeRes.body.status).toBe('FINALIZED');
    expect(finalizeRes.body.invoice_number).toMatch(/^RE-/);
  });

  it('AUT-299: blocks workshop issue when customer identity is incomplete', async () => {
    await tenantPrisma.customer.update({
      where: { id: customerId },
      data: { address_street: null },
    });

    const { invoice } = await createCompletedWorkshopDraftInvoice();
    const sequenceBefore = await tenantPrisma.invoiceSequence.findMany();

    const response = await request(app.getHttpServer())
      .patch(`/api/invoices/${invoice.id}/issue`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(422);

    expect(response.body.code).toBe('CUSTOMER_IDENTITY_INCOMPLETE');
    expect(response.body.missingFields).toContain('address_street');

    const sequenceAfter = await tenantPrisma.invoiceSequence.findMany();
    expect(sequenceAfter).toEqual(sequenceBefore);

    const stored = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoice.id },
    });
    expect(stored.status).toBe('DRAFT');

    await tenantPrisma.customer.update({
      where: { id: customerId },
      data: { address_street: 'Kundenstraße 2' },
    });
  });

  it('AUT-299: blocks sales finalize when fiscal period is locked', async () => {
    const draft = await createSalesOrderInvoice();

    await request(app.getHttpServer())
      .patch('/api/finance/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ lock_date: '2099-12-31T00:00:00.000Z' })
      .expect(200);

    const response = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${draft.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(422);

    expect(response.body.code).toBe('FISCAL_PERIOD_LOCKED');

    const invoiceAfter = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: draft.id },
    });
    expect(invoiceAfter.status).toBe('DRAFT');

    await request(app.getHttpServer())
      .patch('/api/finance/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ lock_date: null })
      .expect(200);
  });
});
