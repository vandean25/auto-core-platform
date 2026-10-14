import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createWorkshopInvoicingSuite,
  createWorkshopVehicle,
  disposeWorkshopInvoicingSuite,
} from './helpers/workshop-invoicing-suite.js';

describe('Workshop Invoicing (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    ({ app, basePrisma, prisma, tenantId, authToken, customerId } =
      await createWorkshopInvoicingSuite());
  });

  afterAll(async () => {
    await disposeWorkshopInvoicingSuite({ app, basePrisma, prisma, tenantId });
  });

  beforeEach(async () => {
    vehicleId = await createWorkshopVehicle(prisma, customerId);
  });

  it('deletes a task, removes its line items, and recalculates the order status', async () => {
    const api = request(app.getHttpServer());

    const orderRes = await api
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 90000,
        fuelLevel: 55,
        notes: 'Service inspection',
      })
      .expect(201);

    const orderId = orderRes.body.id;

    const taskRes = await api
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Inspection task' })
      .expect(201);

    const taskId = taskRes.body.id;

    await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-INSPECT',
            description: 'Inspection labor',
            qty: 1,
            unitPrice: 65,
          },
        ],
      })
      .expect(200);

    const deleteRes = await api
      .delete(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(deleteRes.body.id).toBe(orderId);
    expect(deleteRes.body.status).toBe('INTAKE');
    expect(deleteRes.body.tasks).toHaveLength(0);

    const persistedTask = await prisma.workshopTask.findFirst({
      where: { id: taskId },
    });
    expect(persistedTask).toBeNull();

    const persistedLineItems = await prisma.workshopTaskLineItem.findMany({
      where: { workshop_task_id: taskId },
    });
    expect(persistedLineItems).toHaveLength(0);
  });

  it('blocks deleting a task after a draft invoice exists', async () => {
    const api = request(app.getHttpServer());

    const orderRes = await api
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 91000,
        fuelLevel: 50,
        notes: 'Draft invoice protection',
      })
      .expect(201);

    const orderId = orderRes.body.id;

    const taskRes = await api
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Invoice protected task' })
      .expect(201);

    const taskId = taskRes.body.id;

    await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-PROTECT',
            description: 'Protected labor',
            qty: 1,
            unitPrice: 25,
          },
        ],
      })
      .expect(200);

    await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    await api
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderId })
      .expect(201);

    const deleteRes = await api
      .delete(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);

    expect(deleteRes.body.message).toBe(
      'Workshop order already has an invoice; tasks cannot be deleted',
    );
  });
});
