import { readFile } from 'node:fs/promises';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  WorkshopMediaPurpose,
  WorkshopMediaUrlStrategy,
} from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { MechanicMediaStorage } from '../src/mechanic/mechanic-media.storage.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { readWorkshopCheckInOrphanUploadPurgeConfig } from '../src/workshop/workshop-check-in-orphan-upload-cleanup.config.js';
import { purgeOrphanCheckInUploadsForTenant } from '../src/workshop/workshop-check-in-orphan-upload-cleanup.js';
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

describe('Workshop check-in orphan upload cleanup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;
  let orderId: string;
  let checkInId: string;
  let employeeId: string;
  const deleteObjectSpy = jest.fn().mockResolvedValue(undefined);

  const mockMediaStorage: Partial<MechanicMediaStorage> = {
    uploadCheckInPhoto: jest.fn().mockImplementation(async (params) => ({
      storageBucket: 'test-workshop-media-bucket',
      storageKey: `tenants/${params.tenantId}/orders/${params.orderId}/check-in/${params.checkInId}/${params.objectId}.jpg`,
    })),
    uploadCheckInSignature: jest.fn().mockImplementation(async (params) => ({
      storageBucket: 'test-workshop-media-bucket',
      storageKey: `tenants/${params.tenantId}/orders/${params.orderId}/check-in/${params.checkInId}/${params.objectId}.png`,
    })),
    generateSignedReadUrl: jest
      .fn()
      .mockResolvedValue('https://example.test/photo.jpg'),
    deleteObjectIfExists: deleteObjectSpy,
    deleteObjectOrIgnoreNotFound: deleteObjectSpy,
    readObjectBytes: jest.fn().mockResolvedValue(Buffer.from('png')),
  };

  beforeAll(async () => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';
    process.env.WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_TTL_HOURS = '24';

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
    const tenant = await createTestTenant(basePrisma, 'aut562');
    tenantId = tenant.tenantId;
    authToken = createTestAuthToken(authService, tenant);
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    const siteId = await resolveTestMainSiteId(basePrisma, tenantId);

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Service',
        last_name: 'Guest',
        email: `aut562-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'VW',
        model: 'Polo',
        year: 2021,
        vin: `VIN-AUT562-${Date.now()}`,
        customer_id: customer.id,
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        order_number: `WO-AUT562-${Date.now()}`,
        site_id: siteId,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        odometer: 50000,
        fuel_level: 50,
        status: 'INTAKE',
      },
    });
    orderId = order.id;
    checkInId = '51500000-0000-4000-8000-000000000562';

    const authUser = await basePrisma.user.findUnique({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    if (!authUser) {
      throw new Error('Expected test auth user');
    }
    const employee = await runWithTenantContext(tenantId, () =>
      seedTestEmployee(basePrisma, {
        tenantId,
        name: 'Advisor Purge',
        role: 'SERVICE_ADVISOR',
        userId: authUser.id,
      }),
    );
    employeeId = employee.id;

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ id: checkInId })
      .expect(201);
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(app.get(PrismaService), tenantId);
    await teardownTestApp(app);
  });

  async function runPurge(now = new Date()) {
    const config = readWorkshopCheckInOrphanUploadPurgeConfig();
    const cutoff = new Date(now.getTime() - config.ttlMs);
    return purgeOrphanCheckInUploadsForTenant(
      prisma,
      app.get(MechanicMediaStorage),
      tenantId,
      cutoff,
      config.batchSize,
    );
  }

  it('deletes unattached check-in media older than the TTL', async () => {
    const orphanId = '51500000-0000-4000-8000-000000000563';
    const storageKey = `tenants/${tenantId}/orphan/${orphanId}.jpg`;
    const staleCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

    await prisma.workshopMedia.create({
      data: {
        id: orphanId,
        tenant_id: tenantId,
        workshop_order_id: orderId,
        workshop_task_id: null,
        check_in_id: null,
        uploaded_by_employee_id: employeeId,
        purpose: WorkshopMediaPurpose.CHECK_IN,
        storage_bucket: 'test-workshop-media-bucket',
        storage_key: storageKey,
        url_strategy: WorkshopMediaUrlStrategy.SIGNED,
        mime_type: 'image/jpeg',
        size_bytes: 1024,
        createdAt: staleCreatedAt,
      },
    });

    deleteObjectSpy.mockClear();
    const counts = await runPurge();
    expect(counts.deleted).toBe(1);

    const row = await prisma.workshopMedia.findFirst({
      where: { tenant_id: tenantId, id: orphanId },
    });
    expect(row).toBeNull();
    expect(deleteObjectSpy).toHaveBeenCalledWith(
      'test-workshop-media-bucket',
      storageKey,
    );

    deleteObjectSpy.mockClear();
    const secondPass = await runPurge();
    expect(secondPass.deleted).toBe(0);
    expect(deleteObjectSpy).not.toHaveBeenCalled();
  });

  it('does not delete draft-attached media linked via offline client_upload_id', async () => {
    const clientUploadId = '51500000-0000-4000-8000-000000000558';
    const before = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const bytes = await readFile(gpsFixture);
    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/media`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('client_upload_id', clientUploadId)
      .field('purpose', 'CHECK_IN')
      .field('expected_revision', String(before.body.revision))
      .attach('file', bytes, 'draft-photo.jpg')
      .expect((res) => {
        expect([200, 201]).toContain(res.status);
      });

    await prisma.workshopMedia.updateMany({
      where: { tenant_id: tenantId, id: clientUploadId },
      data: {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });

    deleteObjectSpy.mockClear();
    const counts = await runPurge();
    expect(counts.deleted).toBe(0);

    const attached = await prisma.workshopMedia.findFirst({
      where: { tenant_id: tenantId, id: clientUploadId },
    });
    expect(attached?.check_in_id).toBe(checkInId);
    expect(deleteObjectSpy).not.toHaveBeenCalled();
  });

  it('does not delete media after check-in completion', async () => {
    const signatureId = '51500000-0000-4000-8000-000000000564';
    const before = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const signatureBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in/media`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('client_upload_id', signatureId)
      .field('purpose', 'CHECK_IN_SIGNATURE')
      .field('expected_revision', String(before.body.revision))
      .attach('file', signatureBytes, {
        filename: 'signature.png',
        contentType: 'image/png',
      })
      .expect((res) => {
        expect([200, 201]).toContain(res.status);
      });

    const afterUpload = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
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

    const completedMedia = await prisma.workshopMedia.findMany({
      where: {
        tenant_id: tenantId,
        check_in_id: checkInId,
        purpose: {
          in: [
            WorkshopMediaPurpose.CHECK_IN,
            WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
          ],
        },
      },
    });
    expect(completedMedia.length).toBeGreaterThan(0);

    await prisma.workshopMedia.updateMany({
      where: {
        tenant_id: tenantId,
        check_in_id: checkInId,
      },
      data: {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });

    deleteObjectSpy.mockClear();
    const counts = await runPurge();
    expect(counts.deleted).toBe(0);

    const remaining = await prisma.workshopMedia.count({
      where: { tenant_id: tenantId, check_in_id: checkInId },
    });
    expect(remaining).toBe(completedMedia.length);
    expect(deleteObjectSpy).not.toHaveBeenCalled();
  });
});
