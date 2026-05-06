import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantAwarePrisma, createTestTenant } from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Workshop Labor Metadata (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerId: string;
  let vehicleId: string;
  let laborOperationId: string;

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

    const testTenant = await createTestTenant(prisma);
    prisma = createTenantAwarePrisma(prisma, testTenant.tenantId);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Workshop',
        last_name: 'Labor Tester',
        email: `workshop-labor-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'BMW',
        model: 'X5',
        year: 2022,
        vin: `VIN-WL-${Date.now()}`,
        customer_id: customerId,
      },
    });
    vehicleId = vehicle.id;

    const laborOperation = await prisma.laborOperation.create({
      data: {
        code: `LAB-E2E-${Date.now()}`,
        description: 'Workshop labor metadata operation',
        standard_aw: 1.5,
        hourly_rate: 120,
        internal_cost: 65,
        is_active: true,
      },
    });
    laborOperationId = laborOperation.id;
  });

  afterAll(async () => {
    if (customerId) {
      await prisma.invoiceItem.deleteMany({
        where: { invoice: { workshop_order: { customer_id: customerId } } },
      });
      await prisma.invoice.deleteMany({
        where: { workshop_order: { customer_id: customerId } },
      });
      await prisma.workshopTaskLineItem.deleteMany({
        where: {
          workshop_task: { workshop_order: { customer_id: customerId } },
        },
      });
      await prisma.workshopTask.deleteMany({
        where: { workshop_order: { customer_id: customerId } },
      });
      await prisma.workshopOrder.deleteMany({
        where: { customer_id: customerId },
      });
      await prisma.vehicle.deleteMany({ where: { customer_id: customerId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
    }
    if (laborOperationId) {
      await prisma.laborFitment.deleteMany({
        where: { labor_operation_id: laborOperationId },
      });
      await prisma.laborOperation.deleteMany({
        where: { id: laborOperationId },
      });
    }
    await teardownTestApp(app, prisma);
  });

  it('persists and updates labor metadata, then creates invoice from the completed order', async () => {
    const api = request(app.getHttpServer());

    const orderRes = await api
      .post('/api/workshop/orders')
      .set('x-api-key', 'test-api-key')
      .send({
        customerId,
        vehicleId,
        odometer: 100000,
        fuelLevel: 50,
        notes: 'Labor metadata happy path',
      })
      .expect(201);

    const orderId = orderRes.body.id;

    const taskRes = await api
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set('x-api-key', 'test-api-key')
      .send({ title: 'Engine diagnostic labor' })
      .expect(201);

    const taskId = taskRes.body.id;

    const firstSaveRes = await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('x-api-key', 'test-api-key')
      .send({
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-ENG-01',
            description: 'Engine diagnostic labor',
            qty: 1.5,
            unitPrice: 120,
            laborOperationId,
            standardAw: 1.5,
            actualHours: 1.75,
            internalCostRate: 65,
          },
        ],
      })
      .expect(200);

    const firstLineItem = firstSaveRes.body.tasks[0].lineItems[0];
    expect(firstLineItem.laborOperationId).toBe(laborOperationId);
    expect(firstLineItem.standardAw).toBe(1.5);
    expect(firstLineItem.actualHours).toBe(1.75);
    expect(firstLineItem.internalCostRate).toBe(65);

    const secondSaveRes = await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('x-api-key', 'test-api-key')
      .send({
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-ENG-01',
            description: 'Engine diagnostic labor',
            qty: 1.5,
            unitPrice: 120,
            laborOperationId,
            standardAw: 1.5,
            actualHours: 2.25,
            internalCostRate: 65,
          },
        ],
      })
      .expect(200);

    const updatedLineItem = secondSaveRes.body.tasks[0].lineItems[0];
    expect(updatedLineItem.actualHours).toBe(2.25);

    const persistedLineItem = await prisma.workshopTaskLineItem.findFirst({
      where: { workshop_task_id: taskId },
    });
    expect(persistedLineItem).toBeDefined();
    expect(persistedLineItem?.labor_operation_id).toBe(laborOperationId);
    expect(Number(persistedLineItem?.standard_aw)).toBe(1.5);
    expect(Number(persistedLineItem?.actual_hours)).toBe(2.25);
    expect(Number(persistedLineItem?.internal_cost_rate)).toBe(65);

    await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('x-api-key', 'test-api-key')
      .send({ status: 'DONE' })
      .expect(200);

    const draftInvoiceRes = await api
      .post('/api/invoices/drafts')
      .set('x-api-key', 'test-api-key')
      .send({ workshopOrderId: orderId })
      .expect(201);

    const invoiceLaborLine = draftInvoiceRes.body.items.find(
      (item: { description: string }) =>
        item.description === 'Engine diagnostic labor',
    );

    expect(invoiceLaborLine).toBeDefined();
    expect(Number(invoiceLaborLine.line_total)).toBeCloseTo(180);
  });

  it('rejects non-existent laborOperationId with a controlled validation error', async () => {
    const api = request(app.getHttpServer());

    const orderRes = await api
      .post('/api/workshop/orders')
      .set('x-api-key', 'test-api-key')
      .send({
        customerId,
        vehicleId,
        odometer: 101000,
        fuelLevel: 48,
        notes: 'Invalid labor operation test',
      })
      .expect(201);

    const orderId = orderRes.body.id;

    const taskRes = await api
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set('x-api-key', 'test-api-key')
      .send({ title: 'Invalid labor operation reference' })
      .expect(201);

    const taskId = taskRes.body.id;

    const invalidRes = await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('x-api-key', 'test-api-key')
      .send({
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-INVALID',
            description: 'Invalid operation labor line',
            qty: 1,
            unitPrice: 100,
            laborOperationId: '00000000-0000-0000-0000-000000000001',
            standardAw: 1,
            actualHours: 1,
            internalCostRate: 50,
          },
        ],
      })
      .expect(400);

    expect(invalidRes.body.message).toContain('laborOperationId');
  });
});
