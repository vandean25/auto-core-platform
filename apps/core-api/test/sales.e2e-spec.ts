import { AuthService } from '../src/auth/auth.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { createGlobalValidationPipe } from './../src/common/index.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTenantAwarePrisma, createTestAuthToken, createTestTenant, resolveTestMainSiteId } from './tenant-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('SalesController (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
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

    const testTenant = await createTestTenant(prisma);
    prisma = createTenantAwarePrisma(prisma, testTenant.tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

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

    await seedReadySellerAndAccountingProfile(prisma, testTenant.tenantId);
    const customer = await seedInvoiceReadyCustomer(prisma, testTenant.tenantId);
    customerId = customer.id;

    const catalogItem = await prisma.catalogItem.create({
      data: {
        sku: `TEST-ITEM-${Date.now()}`,
        name: 'Test Item',
        cost_price: 10,
        retail_price: 20,
      },
    });
    catalogItemId = catalogItem.id;

    // Create Stock
    const siteId = await resolveTestMainSiteId(prisma, testTenant.tenantId);
    const location = await prisma.storageLocation.create({
      data: {
        code: `LOC-${Date.now()}`,
        name: 'Test Location',
        type: 'warehouse',
        site_id: siteId,
      },
    });

    await prisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItemId,
        site_id: siteId,
        location_id: location.id,
        quantity_on_hand: 100,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.inventoryTransaction.deleteMany();
    await prisma.inventoryStock.deleteMany();
    await prisma.storageLocation.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.salesOrderItem.deleteMany();
    await prisma.salesOrder.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.catalogItem.deleteMany();
    await prisma.revenueGroup.deleteMany();
    await prisma.brand.deleteMany();
    await teardownTestApp(app, prisma);
  });

  it('/api/sales/invoices (POST) - rejects source-less draft creation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/sales/invoices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId: customerId,
        items: [
          {
            catalogItemId: catalogItemId,
            description: 'Test Item Snapshot',
            quantity: 2,
            unitPrice: 20,
            taxRate: 20,
          },
        ],
      })
      .expect(400);

    expect(response.body.code).toBe('SOURCE_DOCUMENT_REQUIRED');
  });

  it('Finalize Invoice Workflow via sales order source', async () => {
    const orderRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
            description: 'Finalize Test Item',
            quantity: 1,
            unit_price: 100,
            tax_rate: 20,
          },
        ],
      })
      .expect(201);

    await prisma.salesOrder.updateMany({
      where: { id: orderRes.body.id },
      data: { status: 'CONFIRMED' },
    });

    const draftResponse = await request(app.getHttpServer())
      .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const finalizeResponse = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${draftResponse.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(finalizeResponse.body.status).toBe('FINALIZED');
    expect(finalizeResponse.body.invoice_number).toMatch(/^RE-\d{4}-\d{4}$/);
    expect(finalizeResponse.body.snapshot?.schema_version).toBe(2);
  });
});
