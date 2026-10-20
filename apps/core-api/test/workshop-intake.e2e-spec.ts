import { createE2eApp } from './helpers/e2e-suite.js';
import { AuthService } from '../src/auth/auth.service.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
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
    app = await createE2eApp();

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

    const dueListAfterOrderCompletion = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?status=UNKNOWN')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(
      dueListAfterOrderCompletion.body.data.find(
        (vehicle: { id: string }) => vehicle.id === pickerlVehicleId,
      ),
    ).toEqual(expect.objectContaining({ open_pickerl_order: null }));

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

describe('Workshop intake — registration document (AUT-537)', () => {
  let app: INestApplication;
  let authToken: string;
  let tenantId: string;

  beforeAll(async () => {
    process.env.REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER = 'fake';
    const { REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER } = await import(
      '../src/registration-intake/registration-document-extraction-provider.js'
    );
    const { createRegistrationDocumentExtractionProvider } = await import(
      '../src/registration-intake/registration-document-extraction-provider.factory.js'
    );
    const { REGISTRATION_INTAKE_BYTE_STORAGE } = await import(
      '../src/registration-intake/registration-intake-byte-storage.js'
    );
    const { InMemoryRegistrationIntakeByteStorage } = await import(
      './support/in-memory-registration-intake-storage.js'
    );
    const { encodeRegistrationIntakeFixtureBytes } = await import(
      '../src/registration-intake/registration-intake-fixture-bytes.js'
    );
    (globalThis as { __regIntakeBytes?: typeof encodeRegistrationIntakeFixtureBytes }).__regIntakeBytes =
      encodeRegistrationIntakeFixtureBytes;

    app = await createE2eApp((builder) =>
      builder
        .overrideProvider(REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER)
        .useFactory({
          factory: () =>
            createRegistrationDocumentExtractionProvider(process.env),
        })
        .overrideProvider(REGISTRATION_INTAKE_BYTE_STORAGE)
        .useValue(new InMemoryRegistrationIntakeByteStorage()),
    );
    const prisma = app.get(PrismaService);
    const tenant = await createTestTenant(prisma, 'workshop-reg-intake');
    tenantId = tenant.tenantId;
    authToken = createTestAuthToken(app.get(AuthService), tenant);
  });

  afterAll(async () => {
    if (tenantId) {
      const prisma = app.get(PrismaService);
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      await tenantPrisma.registrationIntakeBytePurge.deleteMany({
        where: { tenant_id: tenantId },
      });
      await tenantPrisma.registrationDocumentIntake.deleteMany({
        where: { tenant_id: tenantId },
      });
      await cleanupTestTenantGraph(prisma, tenantId);
    }
    await teardownTestApp(app);
  });

  it('photo → review → confirmed customer/vehicle without duplicate on re-apply', async () => {
    const encode = (globalThis as { __regIntakeBytes: (id: string) => Buffer }).__regIntakeBytes;
    const front = encode('front-clear');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'workshop-snap-1')
      .field('sides', 'FRONT')
      .attach('files', front, 'front.jpg')
      .expect(201);
    expect(create.body.state).toBe('AWAITING_REVIEW');

    const body = {
      vin: 'WVWZZZSYNTH000001',
      plate: 'W SYNTH 1',
      holder: { firstName: 'pilot', lastName: 'customer' },
      nationalcode: 'NC1001',
      firstRegistration: '2019-03-12',
      make: 'Synthetic',
      model: 'Demo',
      year: 2019,
    };
    await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(body)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(body)
      .expect(200);

    const tenantPrisma = createTenantAwarePrisma(app.get(PrismaService), tenantId);
    expect(await tenantPrisma.vehicle.count()).toBe(1);
  });
});
