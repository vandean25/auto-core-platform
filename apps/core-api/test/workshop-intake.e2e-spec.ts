import { AuthService } from '../src/auth/auth.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  seedTestEmployee,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { seedPickerlInspectionTemplate } from '../src/prisma/fixtures/pickerl-inspection-template.fixture.js';

describe('Workshop Intake Module (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let techAuthToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let customerId: string;
  let vehicleId: string;
  let tenantId: string;
  let pickerlVehicleId: string;
  let techEmployeeId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'workshop-intake');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
    const techIdentity = {
      firebaseUid: `e2e-tech-${tenantId}`,
      email: `e2e-tech-${tenantId}@example.com`,
      tenantId,
      role: 'TECH' as const,
    };
    techAuthToken = createTestAuthToken(app.get(AuthService), techIdentity);
    const siteId = await resolveTestMainSiteId(basePrisma, tenantId);
    const techUser = await prisma.user.create({
      data: {
        firebaseUid: techIdentity.firebaseUid,
        email: techIdentity.email,
        active_tenant_id: tenantId,
        active_site_id: siteId,
        memberships: {
          create: { tenant_id: tenantId, role: 'TECH', is_active: true },
        },
      },
      select: { id: true },
    });
    await prisma.siteMembership.create({
      data: {
        tenant_id: tenantId,
        user_id: techUser.id,
        site_id: siteId,
        is_active: true,
      },
    });
    const techEmployee = await seedTestEmployee(prisma, {
      tenantId,
      name: 'E2E Technician',
      role: 'MECHANIC',
      userId: techUser.id,
    });
    techEmployeeId = techEmployee.id;

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Workshop',
        last_name: 'Tester',
        email: 'workshop@test.com',
        phone: '+43 660 000000',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        customer_id: customerId,
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        vin: 'TESTVIN123456789',
        plate: 'W-1234AB',
      },
    });
    vehicleId = vehicle.id;
    const pickerlVehicle = await prisma.vehicle.create({
      data: {
        customer_id: customerId,
        make: 'Toyota',
        model: 'Yaris',
        year: 2021,
        vin: 'PICKERLVIN1234567',
        plate: 'W-57A123',
        first_registration_date: new Date('2021-05-01T00:00:00.000Z'),
      },
    });
    pickerlVehicleId = pickerlVehicle.id;
    await seedPickerlInspectionTemplate(prisma, tenantId);
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('/api/workshop/search (GET) - should find vehicle by VIN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workshop/search?q=TESTVIN')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.data.vehicles).toBeDefined();
    expect(res.body.data.vehicles.length).toBeGreaterThan(0);
    expect(res.body.data.vehicles[0].vin).toBe('TESTVIN123456789');
  });

  it('/api/workshop/orders (POST) - should create workshop order', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 50000,
        fuelLevel: 75,
        notes: 'Check engine light',
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.order_number).toMatch(/^WO-\d{4}-\d+$/);
    expect(res.body.status).toBe('INTAKE');
    expect(res.body.odometer).toBe(50000);
  });

  it('/api/workshop/orders (POST) - should validate fuel level', async () => {
    await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 50000,
        fuelLevel: 101, // Invalid
        notes: 'Check engine light',
      })
      .expect(400);
  });

  it('creates one §57a order, exposes its checklist, and records Pickerl after completion', async () => {
    await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${techAuthToken}`)
      .send({
        customerId,
        vehicleId: pickerlVehicleId,
        odometer: 18000,
        fuelLevel: 50,
        createPickerlTask: true,
      })
      .expect(403);

    const createOrder = () =>
      request(app.getHttpServer())
        .post('/api/workshop/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          vehicleId: pickerlVehicleId,
          odometer: 18000,
          fuelLevel: 50,
          createPickerlTask: true,
        });

    const firstOrder = await createOrder().expect(201);
    const secondOrder = await createOrder().expect(201);
    expect(secondOrder.body.id).toBe(firstOrder.body.id);
    expect(firstOrder.body.tasks).toHaveLength(1);
    expect(firstOrder.body.tasks[0].title).toBe('§57a Begutachtung');

    const taskId = firstOrder.body.tasks[0].id as string;
    await prisma.workshopTask.updateMany({
      where: { id: taskId, tenant_id: tenantId },
      data: { mechanic_id: techEmployeeId },
    });
    const checklist = await request(app.getHttpServer())
      .get(
        `/api/workshop/orders/${firstOrder.body.id}/tasks/${taskId}/checklist`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(checklist.body.title).toContain('§57a Vorbereitung');
    expect(checklist.body.items).toHaveLength(12);

    await request(app.getHttpServer())
      .get(`/api/mechanic/tasks/${taskId}/checklist`)
      .set('Authorization', `Bearer ${techAuthToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/mechanic/tasks/${taskId}/checklist`)
      .set('Authorization', `Bearer ${techAuthToken}`)
      .send({ items: [{ id: checklist.body.items[0].id, passed: true }] })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${firstOrder.body.id}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    const dueListWithOpenOrder = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?status=UNKNOWN')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(
      dueListWithOpenOrder.body.data.find(
        (vehicle: { id: string }) => vehicle.id === pickerlVehicleId,
      ),
    ).toEqual(
      expect.objectContaining({
        open_pickerl_order: {
          id: firstOrder.body.id,
          order_number: firstOrder.body.order_number,
        },
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/vehicles/${pickerlVehicleId}/inspection-records`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        inspection_type: 'PICKERL_57A',
        inspected_on: '2026-10-07',
        plaketten_valid_until_year: 2028,
        plaketten_valid_until_month: 10,
      })
      .expect(201);

    const dueList = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?status=OVERDUE')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(
      dueList.body.data.some(
        (vehicle: { id: string }) => vehicle.id === pickerlVehicleId,
      ),
    ).toBe(false);
  });

  it('/api/workshop/register (POST) - should register vehicle using upsert', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/workshop/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vin: 'NEWVIN123',
        plate: 'NEW-PLATE',
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        firstName: 'New',
        lastName: 'User',
        email: 'new@test.com',
      })
      .expect(201);

    expect(res.body.vin).toBe('NEWVIN123');
  });
});
