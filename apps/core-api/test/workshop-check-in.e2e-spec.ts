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
  let lastSignatureBytes: Buffer | undefined;
  const mockMediaStorage: Partial<MechanicMediaStorage> = {
    uploadCheckInPhoto: jest.fn().mockImplementation(async (params) => {
      lastUploadedCheckInBytes = params.bytes;
      return {
        storageBucket: 'test-workshop-media-bucket',
        storageKey: `tenants/t/check-in/${params.objectId ?? 'photo'}.jpg`,
      };
    }),
    uploadCheckInSignature: jest.fn().mockImplementation(async (params) => {
      lastSignatureBytes = params.bytes;
      return {
        storageBucket: 'test-workshop-media-bucket',
        storageKey: `tenants/t/check-in/${params.objectId ?? 'signature'}.png`,
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
      .mockResolvedValue('https://example.test/photo.jpg'),
    deleteObjectIfExists: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
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
        tenant_id: tenantId,
        first_name: 'Pilot',
        last_name: 'Customer',
        email: `aut555-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'VW',
        model: 'Golf',
        year: 2020,
        vin: `VIN-AUT555-${Date.now()}`,
        customer_id: customer.id,
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
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
        tenant_id: otherTenantId,
        first_name: 'Other',
        last_name: 'Tenant',
        email: `aut555-other-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const otherVehicle = await otherPrisma.vehicle.create({
      data: {
        tenant_id: otherTenantId,
        make: 'Audi',
        model: 'A3',
        year: 2019,
        vin: `VIN-AUT555-OTHER-${Date.now()}`,
        customer_id: otherCustomer.id,
      },
    });
    const otherOrder = await otherPrisma.workshopOrder.create({
      data: {
        tenant_id: otherTenantId,
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
        items_left: 'Umbrella in boot',
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
            zone_id: 'REAR_BUMPER',
            type: 'SCRATCH',
            note: 'Light scratch',
            media_ids: [],
          },
        ],
      })
      .expect(200);

    expect(patchRes.body.revision).toBe(2);
    expect(patchRes.body.items_left).toBe('Umbrella in boot');
    expect(patchRes.body.odometer).toBe(125010);
  });

  it('rejects unknown damage zone_id with CHECK_IN_ZONE_INVALID', async () => {
    const current = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const response = await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: current.body.revision,
        damage_markers: [
          {
            id: '51500000-0000-4000-8000-000000000559',
            zone_id: 'hood',
            type: 'SCRATCH',
            note: '',
            media_ids: [],
          },
        ],
      })
      .expect(400);

    expect(response.body.code).toBe('CHECK_IN_ZONE_INVALID');
  });

  it('rejects unknown damage type with CHECK_IN_DAMAGE_TYPE_INVALID', async () => {
    const current = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const response = await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: current.body.revision,
        damage_markers: [
          {
            id: '51500000-0000-4000-8000-000000000560',
            zone_id: 'BONNET',
            type: 'RUST',
            note: '',
            media_ids: [],
          },
        ],
      })
      .expect(400);

    expect(response.body.code).toBe('CHECK_IN_DAMAGE_TYPE_INVALID');
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
    if (!lastUploadedCheckInBytes) {
      throw new Error('Expected check-in photo bytes to be stored');
    }
    const storedMeta = await sharp(lastUploadedCheckInBytes).metadata();
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

  it('keeps one media row and does not delete storage on overlapping uploads', async () => {
    const deleteSpy = mockMediaStorage.deleteObjectIfExists as jest.Mock;
    deleteSpy.mockClear();

    const clientUploadId = '51500000-0000-4000-8000-000000000559';
    const before = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const bytes = await readFile(gpsFixture);
    const postUpload = () =>
      request(app.getHttpServer())
        .post(`/api/workshop/orders/${orderId}/check-in/media`)
        .set('Authorization', `Bearer ${authToken}`)
        .field('client_upload_id', clientUploadId)
        .field('purpose', 'CHECK_IN')
        .field('expected_revision', String(before.body.revision))
        .attach('file', bytes, 'check-in-overlap.jpg');

    const [first, second] = await Promise.all([postUpload(), postUpload()]);
    const statuses = [first.status, second.status];
    expect(statuses.some((status) => status === 200 || status === 201)).toBe(
      true,
    );
    expect(statuses.every((status) => [200, 201, 409].includes(status))).toBe(
      true,
    );

    const mediaRows = await prisma.workshopMedia.findMany({
      where: { tenant_id: tenantId, id: clientUploadId },
    });
    expect(mediaRows).toHaveLength(1);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('rejects completion without signature evidence', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: before.body.revision,
        signature_media_id: '51500000-0000-4000-8000-000000000560',
        signed_by_name: 'Signer Example',
        acknowledgement_version: 'check-in-signature-v1',
        acknowledgement_locale: 'de',
        acknowledged: true,
      })
      .expect(422)
      .expect((res) => {
        expect(res.body.code).toBe('CHECK_IN_SIGNATURE_REQUIRED');
      });
  });

  it('rejects completion when signature_media_id is a CHECK_IN photo', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const photoBytes = await readFile(gpsFixture);
    const photoId = '51500000-0000-4000-8000-000000000561';
    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/media`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('client_upload_id', photoId)
      .field('purpose', 'CHECK_IN')
      .field('expected_revision', String(before.body.revision))
      .attach('file', photoBytes, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect((res) => {
        expect([200, 201]).toContain(res.status);
      });

    const afterPhoto = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: afterPhoto.body.revision,
        signature_media_id: photoId,
        signed_by_name: 'Signer Example',
        acknowledgement_version: 'check-in-signature-v1',
        acknowledgement_locale: 'de',
        acknowledged: true,
      })
      .expect(422)
      .expect((res) => {
        expect(res.body.code).toBe('CHECK_IN_SIGNATURE_REQUIRED');
      });
  });

  it('uploads CHECK_IN_SIGNATURE PNG and completes with evidence fields', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const signatureBytes = await sharp({
      create: {
        width: 120,
        height: 60,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const signatureId = '51500000-0000-4000-8000-000000000560';
    const uploadRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/media`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('client_upload_id', signatureId)
      .field('purpose', 'CHECK_IN_SIGNATURE')
      .field('expected_revision', String(before.body.revision))
      .attach('file', signatureBytes, {
        filename: 'signature.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(uploadRes.body.purpose).toBe('CHECK_IN_SIGNATURE');
    expect(uploadRes.body.mime_type).toBe('image/png');

    const afterUpload = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const completeRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: afterUpload.body.revision,
        signature_media_id: signatureId,
        signed_by_name: 'Signer Example',
        acknowledgement_version: 'check-in-signature-v1',
        acknowledgement_locale: 'de',
        acknowledged: true,
      })
      .expect(200);

    expect(completeRes.body.status).toBe('COMPLETED');
    expect(completeRes.body.signed_by_name).toBe('Signer Example');
    expect(completeRes.body.signature_media_id).toBe(signatureId);
    expect(completeRes.body.signed_at).toBeTruthy();
    expect(completeRes.body.content_sha256).toHaveLength(64);

    const row = await prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
    });
    expect(row?.device_hash).toHaveLength(64);
    expect(row?.acknowledgement_text).toContain('Freigabe');

    const signatureRow = await prisma.workshopMedia.findFirst({
      where: {
        tenant_id: tenantId,
        check_in_id: row?.id,
        purpose: 'CHECK_IN_SIGNATURE',
      },
    });
    expect(signatureRow?.id).toBe(signatureId);
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
