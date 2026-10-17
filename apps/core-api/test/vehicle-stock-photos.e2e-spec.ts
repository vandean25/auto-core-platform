import { readFile } from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import sharp from 'sharp';
import { exifHasGpsIfd } from '../src/common/media/exif-has-gps-ifd.js';
import { VEHICLE_MEDIA_STORAGE } from '../src/vehicle-stock/vehicle-media/vehicle-media.storage.js';
import { registerVehicleMediaPurgeStorage } from '../src/vehicle-stock/vehicle-media/vehicle-media-purge.registry.js';
import { VehicleMediaService } from '../src/vehicle-stock/vehicle-media/vehicle-media.service.js';
import { InMemoryVehicleMediaStorage } from './support/in-memory-vehicle-media-storage.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';

const gpsFixture = new URL(
  '../src/common/media/fixtures/gps-oriented.jpg',
  import.meta.url,
);

describe('Vehicle stock photos (e2e)', () => {
  const mediaStorage = new InMemoryVehicleMediaStorage();
  let suite: Awaited<ReturnType<typeof createVehicleStockSuite>>;

  beforeAll(async () => {
    registerVehicleMediaPurgeStorage(mediaStorage);
    suite = await createVehicleStockSuite({
      configureModule: (builder) =>
        builder
          .overrideProvider(VEHICLE_MEDIA_STORAGE)
          .useValue(mediaStorage),
    });
  });

  afterAll(async () => {
    await disposeVehicleStockSuite(suite);
  });

  it('uploads a photo with portal variants and strips EXIF/GPS', async () => {
    const created = await suite.createAndReceive({
      vin: vin('PHOTO-1'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const source = await readFile(gpsFixture);
    const before = await sharp(source).metadata();
    expect(exifHasGpsIfd(before.exif!)).toBe(true);

    const uploadRes = await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .attach('file', source, 'photo.jpg')
      .expect(201);

    expect(uploadRes.body).toMatchObject({
      vehicleId,
      isCover: true,
      contentType: 'image/jpeg',
      variants: {
        portal_md: expect.objectContaining({ width: expect.any(Number) }),
        thumbnail: expect.objectContaining({ width: expect.any(Number) }),
      },
    });

    const keysToCheck = [
      uploadRes.body.variants.portal_md.storageKey.replace(
        '/portal_md.jpg',
        '/processed.jpg',
      ),
      uploadRes.body.variants.portal_md.storageKey,
      uploadRes.body.variants.thumbnail.storageKey,
    ];
    for (const key of keysToCheck) {
      const bytes = mediaStorage.objects.get(key);
      expect(bytes).toBeDefined();
      const after = await sharp(bytes).metadata();
      expect(after.exif).toBeUndefined();
    }
  });

  it('reorders photos and rejects foreign tenant access', async () => {
    const created = await suite.createAndReceive({
      vin: vin('PHOTO-2A'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#445566' },
    })
      .png()
      .toBuffer();

    const first = await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .attach('file', png, 'a.png')
      .expect(201);
    const second = await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .attach('file', png, 'b.png')
      .expect(201);

    const reorderRes = await request(suite.app.getHttpServer())
      .put(`/api/vehicle-stock/${vehicleId}/photos/reorder`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({ mediaIds: [second.body.id, first.body.id] })
      .expect(200);

    expect(reorderRes.body.map((row: { id: string }) => row.id)).toEqual([
      second.body.id,
      first.body.id,
    ]);

    await request(suite.app.getHttpServer())
      .put(`/api/vehicle-stock/${vehicleId}/photos/reorder`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({ mediaIds: [second.body.id, first.body.id, first.body.id] })
      .expect(400);

    await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.otherAuthToken}`)
      .expect(404);
  });

  it('keeps a single cover photo and deletes stored objects', async () => {
    const created = await suite.createAndReceive({
      vin: vin('PHOTO-3'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const png = await sharp({
      create: { width: 50, height: 40, channels: 3, background: '#778899' },
    })
      .png()
      .toBuffer();

    const cover = await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .attach('file', png, 'cover.png')
      .expect(201);
    const other = await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .attach('file', png, 'other.png')
      .expect(201);

    const setCoverRes = await request(suite.app.getHttpServer())
      .post(
        `/api/vehicle-stock/${vehicleId}/photos/${other.body.id}/set-cover`,
      )
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);
    expect(setCoverRes.body.isCover).toBe(true);

    const listed = await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);
    const covers = listed.body.filter(
      (row: { isCover: boolean }) => row.isCover,
    );
    expect(covers).toHaveLength(1);
    expect(covers[0].id).toBe(other.body.id);

    const keysBefore = mediaStorage.objects.size;
    await request(suite.app.getHttpServer())
      .delete(`/api/vehicle-stock/${vehicleId}/photos/${cover.body.id}`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(204);
    expect(mediaStorage.objects.size).toBeLessThan(keysBefore);
  });

  it('purges stored photo objects for a vehicle prefix', async () => {
    const created = await suite.createAndReceive({
      vin: vin('PHOTO-PURGE'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const png = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#aabbcc' },
    })
      .png()
      .toBuffer();

    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .attach('file', png, 'purge.png')
      .expect(201);

    const prefix = `tenants/${suite.tenantId}/vehicles/${vehicleId}/media/`;
    expect(
      [...mediaStorage.objects.keys()].some((key) => key.startsWith(prefix)),
    ).toBe(true);

    const vehicleMediaService = suite.app.get(VehicleMediaService);
    await vehicleMediaService.purgeStoredObjectsForVehicle(
      suite.tenantId,
      vehicleId,
    );

    expect(
      [...mediaStorage.objects.keys()].filter((key) => key.startsWith(prefix)),
    ).toHaveLength(0);
  });

  function mediaObjectKeysForVehicle(vehicleId: string): string[] {
    const prefix = `tenants/${suite.tenantId}/vehicles/${vehicleId}/media/`;
    return [...mediaStorage.objects.keys()].filter((key) =>
      key.startsWith(prefix),
    );
  }

  async function createStockVehicleWithPhoto(
    vinTag: string,
  ): Promise<{
    vehicleId: string;
    purchaseId: string;
  }> {
    const created = await suite.createAndReceive({
      vin: vin(vinTag),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const purchaseId = created.purchase.id as string;
    const png = await sharp({
      create: { width: 24, height: 18, channels: 3, background: '#112233' },
    })
      .png()
      .toBuffer();
    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .attach('file', png, 'tx.png')
      .expect(201);
    return { vehicleId, purchaseId };
  }

  async function unlinkPurchaseAndDeleteVehicleInTx(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    purchaseId: string,
  ): Promise<void> {
    await tx.vehiclePurchase.update({
      where: { tenant_id: suite.tenantId, id: purchaseId },
      data: { vehicle_id: null },
    });
    await tx.vehicleLedgerEntry.deleteMany({
      where: { tenant_id: suite.tenantId, vehicle_id: vehicleId },
    });
    await tx.vehicle.delete({
      where: { tenant_id: suite.tenantId, id: vehicleId },
    });
  }

  function batchDeleteVehiclePromises(vehicleId: string, purchaseId: string) {
    return [
      suite.prisma.vehiclePurchase.update({
        where: { tenant_id: suite.tenantId, id: purchaseId },
        data: { vehicle_id: null },
      }),
      suite.prisma.vehicleLedgerEntry.deleteMany({
        where: { tenant_id: suite.tenantId, vehicle_id: vehicleId },
      }),
      suite.prisma.vehicle.delete({
        where: { tenant_id: suite.tenantId, id: vehicleId },
      }),
    ];
  }

  it('defers vehicle media purge until an interactive transaction commits', async () => {
    const { vehicleId, purchaseId } =
      await createStockVehicleWithPhoto('TX-PURGE-C');
    expect(mediaObjectKeysForVehicle(vehicleId).length).toBeGreaterThan(0);

    await suite.prisma.$transaction(async (tx) => {
      await unlinkPurchaseAndDeleteVehicleInTx(tx, vehicleId, purchaseId);
      expect(mediaObjectKeysForVehicle(vehicleId).length).toBeGreaterThan(0);
    });

    expect(mediaObjectKeysForVehicle(vehicleId)).toHaveLength(0);
  });

  it('does not purge vehicle media when an interactive transaction rolls back', async () => {
    const { vehicleId, purchaseId } =
      await createStockVehicleWithPhoto('TX-PURGE-R');
    const keysBefore = mediaObjectKeysForVehicle(vehicleId);
    expect(keysBefore.length).toBeGreaterThan(0);

    await expect(
      suite.prisma.$transaction(async (tx) => {
        await unlinkPurchaseAndDeleteVehicleInTx(tx, vehicleId, purchaseId);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const stillThere = await suite.prisma.vehicle.findFirst({
      where: { tenant_id: suite.tenantId, id: vehicleId },
    });
    expect(stillThere).not.toBeNull();
    expect(mediaObjectKeysForVehicle(vehicleId)).toEqual(keysBefore);
  });

  it('defers vehicle media purge until a batch transaction commits', async () => {
    const { vehicleId, purchaseId } =
      await createStockVehicleWithPhoto('TX-PURGE-BATCH');
    expect(mediaObjectKeysForVehicle(vehicleId).length).toBeGreaterThan(0);

    await suite.prisma.$transaction(batchDeleteVehiclePromises(vehicleId, purchaseId));

    expect(mediaObjectKeysForVehicle(vehicleId)).toHaveLength(0);
  });

  it('does not purge vehicle media when a batch transaction fails after delete', async () => {
    const { vehicleId, purchaseId } =
      await createStockVehicleWithPhoto('TX-PURGE-BF');
    const keysBefore = mediaObjectKeysForVehicle(vehicleId);
    expect(keysBefore.length).toBeGreaterThan(0);

    await expect(
      suite.prisma.$transaction([
        ...batchDeleteVehiclePromises(vehicleId, purchaseId),
        suite.prisma.vehicle.delete({
          where: {
            tenant_id: suite.tenantId,
            id: '00000000-0000-0000-0000-000000000099',
          },
        }),
      ]),
    ).rejects.toMatchObject({ code: 'P2025' });

    const stillThere = await suite.prisma.vehicle.findFirst({
      where: { tenant_id: suite.tenantId, id: vehicleId },
    });
    expect(stillThere).not.toBeNull();
    expect(mediaObjectKeysForVehicle(vehicleId)).toEqual(keysBefore);
  });
});
