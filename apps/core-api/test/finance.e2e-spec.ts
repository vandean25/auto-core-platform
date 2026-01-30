import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('FinanceModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.catalogItem.deleteMany();
    await app.close();
  });

  it('/finance/settings (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/finance/settings')
      .expect(200);

    expect(response.body).toHaveProperty('id', 1);
    expect(response.body).toHaveProperty('invoice_prefix');
  });

  it('/finance/settings (PATCH) - Update lock_date', async () => {
    const lockDate = new Date('2025-12-31').toISOString();
    const response = await request(app.getHttpServer())
      .patch('/finance/settings')
      .send({ lock_date: lockDate })
      .expect(200);

    expect(new Date(response.body.lock_date).toISOString()).toBe(lockDate);
  });

  it('Fiscal Lock Enforcement - Prevent Finalization before lock_date', async () => {
    // 1. Create a customer
    const customer = await prisma.customer.create({
      data: { name: 'Finance Test', email: `fin-${Date.now()}@test.com` },
    });

    // 2. Create an invoice with an old date
    const oldDate = new Date('2025-06-01');
    const invoice = await prisma.invoice.create({
      data: {
        customer_id: customer.id,
        date: oldDate,
        due_date: new Date('2025-06-15'),
        status: 'DRAFT',
        total_net: 100,
        total_tax: 20,
        total_gross: 120,
      },
    });

    // 3. Try to finalize (Settings locked up to 2025-12-31)
    await request(app.getHttpServer())
      .put(`/sales/invoices/${invoice.id}/finalize`)
      .expect(403);
  });

  it('Revenue Group Snapshot - Create Invoice Draft', async () => {
    // 1. Setup Test Data (Self-contained)
    const revGroup = await prisma.revenueGroup.upsert({
        where: { name: 'E2E Test Parts 20%' },
        update: {},
        create: {
            name: 'E2E Test Parts 20%',
            tax_rate: 20.0,
            account_number: 'E2E-4000',
        }
    });

    const customer = await prisma.customer.create({
        data: { name: 'Snapshot Test', email: `snap-${Date.now()}@test.com` },
    });

    const catalogItem = await prisma.catalogItem.create({
      data: {
        sku: `SNAP-ITEM-${Date.now()}`,
        name: 'Snapshot Item',
        cost_price: 50,
        retail_price: 100,
        revenue_group_id: revGroup.id,
      },
    });

    // 2. Create invoice draft
    const response = await request(app.getHttpServer())
      .post('/sales/invoices')
      .send({
        customerId: customer.id,
        items: [
          {
            catalogItemId: catalogItem.id,
            description: 'Snapshot Item',
            quantity: 1,
            unitPrice: 100,
            taxRate: 0, // Should be overridden by revenue group
          },
        ],
      })
      .expect(201);

    expect(response.body.items[0].revenue_group_name).toBe(revGroup.name);
    expect(Number(response.body.items[0].tax_rate)).toBe(20);
  });
});