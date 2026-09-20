import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
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

describe('Legal invoicing snapshot v2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  let authToken: string;
  let siteId: string;
  let customerId: string;
  let catalogItemId: string;

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

    await seedReadySellerAndAccountingProfile(prisma, tenant.tenantId);
    const customer = await seedInvoiceReadyCustomer(prisma, tenant.tenantId);
    customerId = customer.id;

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
  });
});
