import sharp from 'sharp';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { MechanicMediaStorage } from '../src/mechanic/mechanic-media.storage.js';
import { AppModule } from '../src/app.module.js';
import {
  createGlobalValidationPipe,
  GlobalExceptionFilter,
} from '../src/common/index.js';
import { WorkshopCheckInStatus } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  runWithTenantContext,
  seedTestEmployee,
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
  const signatureMediaId = '52500000-0000-4000-8000-000000000564';
  let lastSignatureBytes: Buffer | undefined;

  beforeAll(async () => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MechanicMediaStorage)
      .useValue({
        uploadCheckInPhoto: jest.fn().mockResolvedValue({
          storageBucket: 'test-workshop-media-bucket',
          storageKey: 'photo.jpg',
        }),
        uploadCheckInSignature: jest.fn().mockImplementation(async (params) => {
          lastSignatureBytes = params.bytes;
          return {
            storageBucket: 'test-workshop-media-bucket',
            storageKey: 'signature.png',
          };
        }),
        readObjectBytes: jest.fn().mockImplementation(async () => {
          if (lastSignatureBytes) {
            return lastSignatureBytes;
          }
          return Buffer.from('signature-png');
        }),
        generateSignedReadUrl: jest
          .fn()
          .mockResolvedValue('https://example.test/media'),
        deleteObjectIfExists: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    const basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);
    const tenant = await createTestTenant(basePrisma, 'aut563');
    tenantId = tenant.tenantId;
    authToken = createTestAuthToken(authService, tenant);

    const authUser = await basePrisma.user.findUnique({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    if (!authUser) {
      throw new Error('Expected test auth user to exist');
    }
    await runWithTenantContext(tenantId, () =>
      seedTestEmployee(basePrisma, {
        tenantId,
        name: 'Advisor Upload',
        role: 'SERVICE_ADVISOR',
        userId: authUser.id,
      }),
    );

    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    await seedAnnahmeCheckInspectionTemplate(prisma, tenantId);
    await seedPickerlInspectionTemplate(prisma, tenantId);
    const siteId = await resolveTestMainSiteId(basePrisma, tenantId);

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Check',
        last_name: 'In',
        email: `aut563-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Skoda',
        model: 'Octavia',
        year: 2021,
        vin: `VIN-AUT563-${Date.now()}`,
        customer_id: customer.id,
      },
    });
    const pickerlVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Skoda',
        model: 'Fabia',
        year: 2020,
        vin: `VIN-AUT563-PICKERL-${Date.now()}`,
        customer_id: customer.id,
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
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

    const secondPatch = await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/check-in/inspection`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: checkIn.body.revision,
        items: [{ id: inspection.body.items[1].id, passed: false }],
      })
      .expect(200);

    expect(secondPatch.body.items[1].passed).toBe(false);

    const checkInAfterSecondSave = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(checkInAfterSecondSave.body.revision).toBe(3);
  });

  it('links at most one order-level inspection under concurrent create retries', async () => {
    const anchorOrder = await prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      select: { site_id: true, customer_id: true, vehicle_id: true },
    });
    if (!anchorOrder) {
      throw new Error('Missing anchor workshop order');
    }
    const raceOrder = await prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        order_number: `WO-AUT563-RACE-${Date.now()}`,
        site_id: anchorOrder.site_id,
        customer_id: anchorOrder.customer_id,
        vehicle_id: anchorOrder.vehicle_id,
        odometer: 2,
        fuel_level: 2,
        status: 'INTAKE',
      },
    });
    const raceCheckInId = '52500000-0000-4000-8000-000000000565';

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/workshop/orders/${raceOrder.id}/check-in`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: raceCheckInId }),
      request(app.getHttpServer())
        .post(`/api/workshop/orders/${raceOrder.id}/check-in`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: raceCheckInId }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 201]);

    const inspectionIds = [first.body.inspection_id, second.body.inspection_id];
    expect(inspectionIds[0]).toBeTruthy();
    expect(inspectionIds[1]).toBe(inspectionIds[0]);

    const orderLevelCount = await prisma.workshopInspection.count({
      where: {
        tenant_id: tenantId,
        workshop_order_id: raceOrder.id,
        workshop_task_id: null,
      },
    });
    expect(orderLevelCount).toBe(1);
  });

  it('locks the reception checklist after check-in completion', async () => {
    const checkIn = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const signatureBytes = await sharp({
      create: {
        width: 80,
        height: 40,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/media`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('client_upload_id', signatureMediaId)
      .field('purpose', 'CHECK_IN_SIGNATURE')
      .field('expected_revision', String(checkIn.body.revision))
      .attach('file', signatureBytes, {
        filename: 'signature.png',
        contentType: 'image/png',
      })
      .expect(201);

    const afterSignature = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: afterSignature.body.revision,
        signature_media_id: signatureMediaId,
        signed_by_name: 'Signer Example',
        acknowledgement_version: 'check-in-signature-v1',
        acknowledgement_locale: 'de',
        acknowledged: true,
      })
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

  it('does not attach an inspection when retrying create on a legacy completed check-in', async () => {
    const legacyCheckInId = '52500000-0000-4000-8000-000000000564';
    const anchorOrder = await prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      select: { site_id: true, customer_id: true, vehicle_id: true },
    });
    if (!anchorOrder) {
      throw new Error('Missing anchor workshop order');
    }
    const legacyOrder = await prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        order_number: `WO-AUT563-LEGACY-${Date.now()}`,
        site_id: anchorOrder.site_id,
        customer_id: anchorOrder.customer_id,
        vehicle_id: anchorOrder.vehicle_id,
        odometer: 1,
        fuel_level: 1,
        status: 'IN_PROGRESS',
      },
    });
    await prisma.workshopCheckIn.create({
      data: {
        id: legacyCheckInId,
        tenant_id: tenantId,
        workshop_order_id: legacyOrder.id,
        status: WorkshopCheckInStatus.COMPLETED,
        revision: 2,
        inspection_id: null,
        condition_json: {},
        damage_markers_json: [],
        items_left: '',
        key_count: 0,
        warning_lights: [],
        odometer: 1,
        fuel_level: 1,
        content_sha256: 'a'.repeat(64),
        completed_at: new Date('2026-10-16T10:00:00.000Z'),
      },
    });

    const inspectionsBefore = await prisma.workshopInspection.count({
      where: {
        tenant_id: tenantId,
        workshop_order_id: legacyOrder.id,
        workshop_task_id: null,
      },
    });

    const retry = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${legacyOrder.id}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ id: legacyCheckInId })
      .expect(200);

    expect(retry.body.inspection_id).toBeNull();
    expect(retry.body.status).toBe(WorkshopCheckInStatus.COMPLETED);

    const inspectionsAfter = await prisma.workshopInspection.count({
      where: {
        tenant_id: tenantId,
        workshop_order_id: legacyOrder.id,
        workshop_task_id: null,
      },
    });
    expect(inspectionsAfter).toBe(inspectionsBefore);
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
