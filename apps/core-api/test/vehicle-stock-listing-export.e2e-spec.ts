import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { VEHICLE_MEDIA_STORAGE } from '../src/vehicle-stock/vehicle-media/vehicle-media.storage.js';
import { registerVehicleMediaPurgeStorage } from '../src/vehicle-stock/vehicle-media/vehicle-media-purge.registry.js';
import { InMemoryVehicleMediaStorage } from './support/in-memory-vehicle-media-storage.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';

describe('Vehicle listing export download (e2e)', () => {
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

  async function prepareActiveListing(vehicleId: string, stockPurchaseId: string) {
    const listingId = randomUUID();
    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({ id: listingId, expected_stock_purchase_id: stockPurchaseId })
      .expect(201);

    const png = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#334455' },
    })
      .jpeg()
      .toBuffer();

    const photo = await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/photos`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .attach('file', png, 'listing.jpg')
      .expect(201);

    await suite.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        first_registration_date: new Date('2018-04-01'),
        mileage: 88000,
        fuel_type: 'Benzin',
        power_kw: 77,
        color: 'Blau',
      },
    });

    await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 1,
        description: 'Synthetic export listing.',
        price_gross_eur: 11990,
        vat_display: 'STANDARD',
        nova_included_confirmed: true,
        mandatory_fees_included_confirmed: true,
        photo_ids: [photo.body.id],
      })
      .expect(200);

    await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing/channels/MOBILE_DE`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({ expected_revision: 2, desired_state: 'ACTIVE' })
      .expect(200);
  }

  it('downloads a ZIP package for an active, ready listing', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-EXP'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    await prepareActiveListing(vehicleId, created.received.id);

    const download = await request(suite.app.getHttpServer())
      .get(
        `/api/vehicle-stock/${vehicleId}/listing/export/download?profile=MOBILE_DE_REFERENCE_V1`,
      )
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);

    expect(download.headers['content-type']).toContain('application/zip');
    expect(download.headers['x-checksum-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect((download.body as Buffer).subarray(0, 2).toString('ascii')).toBe(
      'PK',
    );
  });

  it('returns 422 for unsupported serializer profile', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-BAD'),
      sellerType: 'VENDOR',
    });

    const res = await request(suite.app.getHttpServer())
      .get(
        `/api/vehicle-stock/${created.received.vehicle_id}/listing/export/download?profile=UNKNOWN`,
      )
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(422);

    expect(res.body.code).toBe('LISTING_SERIALIZER_UNSUPPORTED');
  });

  it('returns 404 for foreign tenant download', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-FOREIGN'),
      sellerType: 'VENDOR',
    });
    await prepareActiveListing(created.received.vehicle_id, created.received.id);

    await request(suite.app.getHttpServer())
      .get(
        `/api/vehicle-stock/${created.received.vehicle_id}/listing/export/download?profile=MOBILE_DE_REFERENCE_V1`,
      )
      .set('Authorization', `Bearer ${suite.otherAuthToken}`)
      .expect(404);
  });
});
