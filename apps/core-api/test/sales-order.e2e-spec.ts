import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantAwarePrisma, createTestTenant } from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Sales Order Workflow (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  let customerId: string;
  let catalogItemId: string;
  let locationId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const testTenant = await createTestTenant(prisma);
    prisma = createTenantAwarePrisma(prisma, testTenant.tenantId);
    authToken = app.get(AuthService).createTestToken({ tenantId: testTenant.tenantId });

    // Clean up
    try {
      await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE 
          "inventory_transactions",
          "inventory_stocks",
          "storage_locations",
          "invoice_items",
          "invoices",
          "invoice_sequences",
          "sales_order_items",
          "sales_orders",
          "customers",
          "catalog_items",
          "revenue_groups",
          "brands"
        CASCADE;
      `);
    } catch (error) {
      console.error('Cleanup failed:', error);
      throw error;
    }

    // Create Customer
    const customer = await prisma.customer.create({
      data: {
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    // Create Catalog Item
    const item = await prisma.catalogItem.create({
      data: {
        sku: 'PART-001',
        name: 'Oil Filter',
        cost_price: 5.0,
        retail_price: 10.0,
        unit: 'pcs',
      },
    });
    catalogItemId = item.id;

    const location = await prisma.storageLocation.create({
      data: {
        code: `LOC-SO-${Date.now()}`,
        name: `SO-Location-${Date.now()}`,
        type: 'warehouse',
      },
    });
    locationId = location.id;

    await prisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItemId,
        location_id: locationId,
        quantity_on_hand: 100,
      },
    });
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  it('should create a sales order, update it, and convert to invoice', async () => {
    // 1. Create Sales Order
    const createRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
            description: 'Oil Filter',
            quantity: 2,
            unit_price: 10.0,
            tax_rate: 20,
          },
        ],
        notes: 'Test Order',
      })
      .expect(201);

    const orderId = createRes.body.id;
    expect(createRes.body.order_number).toMatch(/SO-2026-\d+/);
    expect(createRes.body.status).toBe('DRAFT');
    expect(createRes.body.total_amount).toBe('20'); // 2 * 10

    // 2. Update Sales Order (Change Quantity)
    await request(app.getHttpServer())
      .patch(`/api/sales-orders/${orderId}`)
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          {
            catalog_item_id: catalogItemId,
            description: 'Oil Filter',
            quantity: 3,
            unit_price: 10.0,
            tax_rate: 20,
          },
        ],
      })
      .expect(200);

    // Verify update
    const updatedOrder = await prisma.salesOrder.findUnique({
      where: { id: orderId },
    });
    expect(Number(updatedOrder.total_amount)).toBe(30);

    // 3. Convert to Invoice
    const invoiceRes = await request(app.getHttpServer())
      .post(`/api/sales-orders/${orderId}/create-invoice`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    expect(invoiceRes.body.sales_order_id).toBe(orderId);
    expect(invoiceRes.body.invoice_number).toBeNull();
    expect(invoiceRes.body.status).toBe('DRAFT');

    const pendingOrder = await prisma.salesOrder.findUnique({
      where: { id: orderId },
    });
    expect(pendingOrder.status).toBe('DRAFT');

    // 4. Update order to CONFIRMED before finalizing invoice (as required by SalesService validation)
    await prisma.salesOrder.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED' },
    });

    // 5. Finalize invoice to lock order
    const finalizeRes = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${invoiceRes.body.id}/finalize`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(finalizeRes.body.status).toBe('FINALIZED');
    expect(finalizeRes.body.invoice_number).toMatch(/RE-\d{4}-\d{4}/);

    const finalOrder = await prisma.salesOrder.findUnique({
      where: { id: orderId },
    });
    expect(finalOrder.status).toBe('INVOICED');
  });

  it('should prevent deleting non-draft orders', async () => {
    // Create order
    const createRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
            description: 'Part',
            quantity: 1,
            unit_price: 10,
            tax_rate: 20,
          },
        ],
      })
      .expect(201);

    const orderId = createRes.body.id;

    // Move to INVOICED directly (via DB to simulate state) or using API
    await prisma.salesOrder.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED' },
    });

    // Attempt Delete
    await request(app.getHttpServer())
      .delete(`/api/sales-orders/${orderId}`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(400); // Bad Request
  });

  it('should maintain sequential numbering', async () => {
    // Create two orders rapidly
    const req = request(app.getHttpServer());

    const [res1, res2] = await Promise.all([
      req
        .post('/api/sales-orders')
          .set('Authorization', `Bearer ${authToken}`)
        .send({ customer_id: customerId, items: [] }),
      req
        .post('/api/sales-orders')
          .set('Authorization', `Bearer ${authToken}`)
        .send({ customer_id: customerId, items: [] }),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.order_number).toBeDefined();
    expect(res2.body.order_number).toBeDefined();

    const num1 = parseInt(res1.body.order_number.split('-').pop());
    const num2 = parseInt(res2.body.order_number.split('-').pop());

    expect(Math.abs(num1 - num2)).toBe(1);
  });
});
