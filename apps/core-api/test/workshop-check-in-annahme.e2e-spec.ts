import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { seedAnnahmeCheckInspectionTemplate } from '../src/prisma/fixtures/annahme-check-inspection-template.fixture.js';
import { seedPickerlInspectionTemplate } from '../src/prisma/fixtures/pickerl-inspection-template.fixture.js';

jest.setTimeout(30000);

describe('Workshop check-in Annahme checklist (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;
  let orderId: string;
  let pickerlOrderId: string;
  let pickerlTaskId: string;
  const checkInId = '52500000-0000-4000-8000-000000000563';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    const basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);
    const tenant = await createTestTenant(basePrisma, 'aut563');
    tenantId = tenant.tenantId;
    authToken = createTestAuthToken(authService, tenant);

    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    await seedAnnahmeCheckInspectionTemplate(prisma, tenantId);
    await seedPickerlInspectionTemplate(prisma, tenantId);
    const siteId = await resolveTestMainSiteId(basePrisma, tenantId);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Check',
        last_name: 'In',
        email: `aut563-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'Skoda',
        model: 'Octavia',
        year: 2021,
        vin: `VIN-AUT563-${Date.now()}`,
        customer_id: customer.id,
      },
    });
    const pickerlVehicle = await prisma.vehicle.create({
      data: {
        make: 'Skoda',
        model: 'Fabia',
        year: 2020,
        vin: `VIN-AUT563-PICKERL-${Date.now()}`,
        customer_id: customer.id,
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        order_number: `WO-AUT563-${Date.now()}`,
        site_id: siteId,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        odometer: 88000,
        fuel_level: 60,
        status: 'INTAKE',
      },
    });
    orderId = order.id;

    const pickerlOrder = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId: customer.id,
        vehicleId: pickerlVehicle.id,
        odometer: 88000,
        fuelLevel: 60,
        createPickerlTask: true,
      })
      .expect(201);
    pickerlOrderId = pickerlOrder.body.id;
    pickerlTaskId = pickerlOrder.body.tasks[0].id;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(app.get(PrismaService), tenantId);
    await teardownTestApp(app);
  });

  it('creates an order-level inspection when check-in is created', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ id: checkInId })
      .expect(201);

    expect(createRes.body.inspection_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const inspection = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in/inspection`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(inspection.body.title).toBe('Annahme-Check');
    expect(inspection.body.items).toHaveLength(8);

    const retry = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ id: checkInId })
      .expect(200);
    expect(retry.body.inspection_id).toBe(createRes.body.inspection_id);

    const orderLevelCount = await prisma.workshopInspection.count({
      where: {
        tenant_id: tenantId,
        workshop_order_id: orderId,
        workshop_task_id: null,
      },
    });
    expect(orderLevelCount).toBe(1);
  });

  it('updates the reception checklist and bumps check-in revision', async () => {
    const inspection = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in/inspection`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const patch = await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/check-in/inspection`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: 1,
        items: [{ id: inspection.body.items[0].id, passed: true }],
      })
      .expect(200);

    expect(patch.body.items[0].passed).toBe(true);

    const checkIn = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(checkIn.body.revision).toBe(2);
  });

  it('locks the reception checklist after check-in completion', async () => {
    const checkIn = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expected_revision: checkIn.body.revision })
      .expect(200);

    const inspection = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in/inspection`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/check-in/inspection`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: checkIn.body.revision + 1,
        items: [{ id: inspection.body.items[0].id, passed: false }],
      })
      .expect(409)
      .expect((res) => {
        expect(res.body.code).toBe('CHECK_IN_COMPLETED');
      });
  });

  it('keeps mechanic task inspections scoped to their task', async () => {
    const taskChecklist = await request(app.getHttpServer())
      .get(
        `/api/workshop/orders/${pickerlOrderId}/tasks/${pickerlTaskId}/checklist`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(taskChecklist.body.title).toContain('§57a Vorbereitung');
    expect(taskChecklist.body.items).toHaveLength(12);

    await request(app.getHttpServer())
      .patch(
        `/api/workshop/orders/${pickerlOrderId}/tasks/${pickerlTaskId}/checklist`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({ items: [{ id: taskChecklist.body.items[0].id, passed: true }] })
      .expect(200);
  });
});
