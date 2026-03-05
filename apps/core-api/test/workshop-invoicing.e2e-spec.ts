import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Workshop Invoicing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "invoice_items",
        "invoices",
        "workshop_task_line_items",
        "workshop_tasks",
        "workshop_orders",
        "vehicles",
        "customers",
        "invoice_sequences"
      CASCADE;
    `);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Workshop',
        last_name: 'Customer',
        email: `workshop-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'BMW',
        model: 'X3',
        year: 2021,
        vin: `VIN-${Date.now()}`,
        customer_id: customerId,
      },
    });
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.workshopTaskLineItem.deleteMany();
    await prisma.workshopTask.deleteMany();
    await prisma.workshopOrder.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.invoiceSequence.deleteMany();
    await app.close();
  });

  it('creates a draft invoice and issues it for a completed workshop order', async () => {
    const api = request(app.getHttpServer());

    const orderRes = await api
      .post('/api/workshop/orders')
      .set('x-api-key', 'test-api-key')
      .send({
        customerId,
        vehicleId,
        odometer: 120000,
        fuelLevel: 40,
        notes: 'Brake noise',
      })
      .expect(201);

    const orderId = orderRes.body.id;
    expect(orderRes.body.order_number).toMatch(/^WO-\d{4}-\d+$/);

    const taskRes = await api
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set('x-api-key', 'test-api-key')
      .send({ title: 'Replace brake pads' })
      .expect(201);

    const taskId = taskRes.body.id;

    await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('x-api-key', 'test-api-key')
      .send({
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-001',
            description: 'Brake labor',
            qty: 2,
            unitPrice: 80,
          },
          {
            type: 'PART',
            itemNo: 'PART-001',
            description: 'Brake pads',
            qty: 1,
            unitPrice: 40,
          },
        ],
      })
      .expect(200);

    const completedRes = await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('x-api-key', 'test-api-key')
      .send({ status: 'DONE' })
      .expect(200);

    expect(completedRes.body.status).toBe('COMPLETED');

    const invoiceRes = await api
      .post('/api/invoices/drafts')
      .set('x-api-key', 'test-api-key')
      .send({ workshopOrderId: orderId })
      .expect(201);

    expect(invoiceRes.body.status).toBe('DRAFT');
    expect(invoiceRes.body.workshop_order_id).toBe(orderId);
    expect(invoiceRes.body.items).toHaveLength(2);

    const laborLine = invoiceRes.body.items.find(
      (item: any) => item.description === 'Brake labor',
    );
    const partLine = invoiceRes.body.items.find(
      (item: any) => item.description === 'Brake pads',
    );

    expect(Number(laborLine.line_total)).toBeCloseTo(160);
    expect(Number(partLine.line_total)).toBeCloseTo(40);
    expect(Number(invoiceRes.body.total_net)).toBeCloseTo(200);
    expect(Number(invoiceRes.body.total_tax)).toBeCloseTo(40);
    expect(Number(invoiceRes.body.total_gross)).toBeCloseTo(240);

    const invoiceId = invoiceRes.body.id;
    const issueRes = await api
      .patch(`/api/invoices/${invoiceId}/issue`)
      .set('x-api-key', 'test-api-key')
      .expect(200);

    expect(issueRes.body.status).toBe('ISSUED');
    expect(issueRes.body.invoice_number).toMatch(/RE-\d{4}-\d{4}/);

    const lockedOrder = await prisma.workshopOrder.findUnique({
      where: { id: orderId },
    });
    expect(lockedOrder?.status).toBe('INVOICED');

    await api
      .patch(`/api/workshop/orders/${orderId}`)
      .set('x-api-key', 'test-api-key')
      .send({ notes: 'Attempt to edit after invoicing' })
      .expect(400);
  });
});
