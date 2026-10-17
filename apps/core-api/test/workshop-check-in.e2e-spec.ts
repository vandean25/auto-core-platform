import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { MechanicMediaStorage } from '../src/mechanic/mechanic-media.storage.js';
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

const gpsFixture = new URL(
  '../src/common/media/fixtures/gps-oriented.jpg',
  import.meta.url,
);

jest.setTimeout(30000);

describe('Workshop check-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let authToken: string;
  let otherAuthToken: string;
  let orderId: string;
  let otherOrderId: string;
  const checkInId = '51500000-0000-4000-8000-000000000555';
  let lastUploadedCheckInBytes: Buffer | undefined;
  const mockMediaStorage: Partial<MechanicMediaStorage> = {
    uploadCheckInPhoto: jest.fn().mockImplementation(async (params) => {
      lastUploadedCheckInBytes = params.bytes;
      return {
        storageBucket: 'test-workshop-media-bucket',
        storageKey: `tenants/t/check-in/${params.objectId ?? 'photo'}.jpg`,
      };
    }),
    generateSignedReadUrl: jest
      .fn()
      .mockResolvedValue('https://example.test/photo.jpg'),
    deleteObjectIfExists: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MechanicMediaStorage)
      .useValue(mockMediaStorage)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    const basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);

    const tenantA = await createTestTenant(basePrisma, 'aut555a');
    const tenantB = await createTestTenant(basePrisma, 'aut555b');
    tenantId = tenantA.tenantId;
    otherTenantId = tenantB.tenantId;
    authToken = createTestAuthToken(authService, tenantA);
    otherAuthToken = createTestAuthToken(authService, tenantB);

    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);
    const siteId = await resolveTestMainSiteId(basePrisma, tenantId);
    const otherSiteId = await resolveTestMainSiteId(basePrisma, otherTenantId);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Pilot',
        last_name: 'Customer',
        email: `aut555-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'VW',
        model: 'Golf',
        year: 2020,
        vin: `VIN-AUT555-${Date.now()}`,
        customer_id: customer.id,
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        order_number: `WO-AUT555-${Date.now()}`,
        site_id: siteId,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        odometer: 125000,
        fuel_level: 40,
        status: 'INTAKE',
      },
    });
    orderId = order.id;

    const otherCustomer = await otherPrisma.customer.create({
      data: {
        first_name: 'Other',
        last_name: 'Tenant',
        email: `aut555-other-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const otherVehicle = await otherPrisma.vehicle.create({
      data: {
        make: 'Audi',
        model: 'A3',
        year: 2019,
        vin: `VIN-AUT555-OTHER-${Date.now()}`,
        customer_id: otherCustomer.id,
      },
    });
    const otherOrder = await otherPrisma.workshopOrder.create({
      data: {
        order_number: `WO-AUT555-OTHER-${Date.now()}`,
        site_id: otherSiteId,
        customer_id: otherCustomer.id,
        vehicle_id: otherVehicle.id,
        odometer: 90000,
        fuel_level: 70,
        status: 'INTAKE',
      },
    });
    otherOrderId = otherOrder.id;

    const authUser = await basePrisma.user.findUnique({
      where: { firebaseUid: tenantA.firebaseUid },
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
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(app.get(PrismaService), tenantId);
    await cleanupTestTenantGraph(app.get(PrismaService), otherTenantId);
    await teardownTestApp(app);
  });

  it('creates, reads, and updates a draft check-in', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ id: checkInId })
      .expect(201);

    expect(createRes.body.odometer).toBe(125000);
    expect(createRes.body.fuel_level).toBe(40);
    expect(createRes.body.status).toBe('DRAFT');
    expect(createRes.body.revision).toBe(1);

    const getRes = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(getRes.body.id).toBe(checkInId);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: 1,
        items_left: 'pilot customer umbrella',
        key_count: 2,
        warning_lights: ['ABS'],
        odometer: 125010,
        fuel_level: 38,
        condition: {
          tyre_season: 'WINTER',
          exterior_notes: 'Light scratch rear bumper',
          interior_notes: '',
        },
        damage_markers: [
          {
            id: '51500000-0000-4000-8000-000000000556',
            zone_id: 'rear_bumper',
            type: 'SCRATCH',
            note: 'pilot customer scratch',
            media_ids: [],
          },
        ],
      })
      .expect(200);

    expect(patchRes.body.revision).toBe(2);
    expect(patchRes.body.items_left).toBe('pilot customer umbrella');
    expect(patchRes.body.odometer).toBe(125010);
  });

  it('returns 200 on idempotent create retry with the same id', async () => {
    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ id: checkInId })
      .expect(200);
  });

  it('uploads CHECK_IN media and bumps revision', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const bytes = await readFile(gpsFixture);
    const uploadRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/media`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('client_upload_id', '51500000-0000-4000-8000-000000000558')
      .field('purpose', 'CHECK_IN')
      .field('expected_revision', String(before.body.revision))
      .attach('file', bytes, 'check-in.jpg')
      .expect(201);

    expect(uploadRes.body.purpose).toBe('CHECK_IN');

    const after = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(after.body.revision).toBe(before.body.revision + 1);

    const listRes = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in/media`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].id).toBe(uploadRes.body.id);
    expect(uploadRes.body.mime_type).toBe('image/jpeg');
    expect(lastUploadedCheckInBytes).toBeDefined();
    const storedMeta = await sharp(lastUploadedCheckInBytes!).metadata();
    expect(storedMeta.exif).toBeUndefined();

    const retryRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/media`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('client_upload_id', '51500000-0000-4000-8000-000000000558')
      .field('purpose', 'CHECK_IN')
      .field('expected_revision', String(after.body.revision))
      .attach('file', bytes, 'check-in.jpg')
      .expect(200);

    expect(retryRes.body.id).toBe(uploadRes.body.id);

    const afterRetry = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(afterRetry.body.revision).toBe(after.body.revision);
  });

  it('isolates check-in reads across tenants', async () => {
    await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/workshop/orders/${otherOrderId}/check-in`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);
  });
});
