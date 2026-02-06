import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Sales Order Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerId: string;
  let catalogItemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Clean up
    try {
      await prisma.$executeRawUnsafe(`
                TRUNCATE TABLE 
                    "invoice_items",
                    "invoices",
                    "sales_order_items",
                    "sales_orders",
                    "customers",
                    "catalog_items",
                    "inventory_stocks",
                    "inventory_transactions",
                    "purchase_order_items",
                    "purchase_orders",
                    "vendors"
                CASCADE;
            `);
    } catch (error) {
      console.error('Cleanup failed:', error);
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a sales order, update it, and convert to invoice', async () => {
    // 1. Create Sales Order
    const createRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
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
      .expect(201);

    expect(invoiceRes.body.sales_order_id).toBe(orderId);
    expect(invoiceRes.body.invoice_number).toMatch(/RE-2026-\d+/);
    expect(invoiceRes.body.status).toBe('DRAFT');

    // Verify Order Status Updated
    const finalOrder = await prisma.salesOrder.findUnique({
      where: { id: orderId },
    });
    expect(finalOrder.status).toBe('INVOICED');
  });

  it('should prevent deleting non-draft orders', async () => {
    // Create order
    const createRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
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
      .expect(400); // Bad Request
  });

  it('should maintain sequential numbering', async () => {
    // Create two orders rapidly
    const req = request(app.getHttpServer());

    const [res1, res2] = await Promise.all([
      req
        .post('/api/sales-orders')
        .send({ customer_id: customerId, items: [] }),
      req
        .post('/api/sales-orders')
        .send({ customer_id: customerId, items: [] }),
    ]);

    const num1 = parseInt(res1.body.order_number.split('-').pop());
    const num2 = parseInt(res2.body.order_number.split('-').pop());

    expect(Math.abs(num1 - num2)).toBe(1);
  });
});
