import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesOrderStatus } from '@prisma/client';

describe('Sales Order Filters (Repro Issue #10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerId: string;

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Global pipes might be needed if the validation relies on them, but for this test maybe not critical
    // But app.setGlobalPrefix('api') is critical as per the other test
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
      throw error;
    }

    // Create Customer
    const customer = await prisma.customer.create({
      data: {
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane.doe@example.com',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    // Create 3 Sales Orders
    await prisma.salesOrder.createMany({
      data: [
        {
          order_number: 'SO-TEST-1',
          customer_id: customerId,
          status: SalesOrderStatus.DRAFT,
          total_amount: 100,
        },
        {
          order_number: 'SO-TEST-2',
          customer_id: customerId,
          status: SalesOrderStatus.CONFIRMED,
          total_amount: 200,
        },
        {
          order_number: 'SO-TEST-3',
          customer_id: customerId,
          status: SalesOrderStatus.DRAFT,
          total_amount: 300,
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should respect pagination parameters (standard)', async () => {
    // ... existing test ...
    // Request page 2, page size 1. Should return 1 item (the 2nd one).
    const res = await request(app.getHttpServer())
      .get(`/api/sales-orders?page=2&pageSize=1`)
      .set('x-api-key', 'test-api-key')
      .expect(200);

    // If it ignores pagination, it returns all 3 (or default 25).
    // If it works, it returns 1.
    // Current implementation returns array directly if params is missing
    if (Array.isArray(res.body)) {
      expect(res.body.length).toBe(1);
    } else {
      expect(res.body.data.length).toBe(1);
    }
  });

  it('should respect pagination parameters (JSON)', async () => {
    const params = JSON.stringify({
      page: 1,
      pageSize: 1,
    });

    const res = await request(app.getHttpServer())
      .get(`/api/sales-orders?params=${encodeURIComponent(params)}`)
      .set('x-api-key', 'test-api-key')
      .expect(200);

    // Should return 1 item (Page 1)
    expect(res.body.data.length).toBe(1);
    expect(res.body.meta.pageSize).toBe(1);
  });

  it('should respect filtering (standard)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/sales-orders?status=CONFIRMED`)
      .set('x-api-key', 'test-api-key')
      .expect(200);

    // Should return 1 item
    if (Array.isArray(res.body)) {
      expect(res.body.length).toBe(1);
      expect(res.body[0].status).toBe('CONFIRMED');
    } else {
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe('CONFIRMED');
    }
  });
});
