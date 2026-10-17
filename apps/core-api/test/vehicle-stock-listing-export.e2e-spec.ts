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

  const exportReadyListingPatch = {
    portal_category: 'Car.Limousine',
    export_assertion_damage_free: true,
    export_assertion_metallic: false,
    export_assertion_guarantee: false,
    export_assertion_jahreswagen: false,
    export_assertion_recommendation: false,
    export_assertion_demo_vehicle: false,
  };

  async function setActiveSiteId(siteId: string) {
    const user = await suite.basePrisma.user.findFirstOrThrow({
      where: { firebaseUid: `e2e-user-${suite.tenantId}` },
    });
    await suite.basePrisma.user.update({
      where: { id: user.id },
      data: { active_site_id: siteId },
    });
  }

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
        ...exportReadyListingPatch,
      })
      .expect(200);

    await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing/channels/MOBILE_DE`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({ expected_revision: 2, desired_state: 'ACTIVE' })
      .expect(200);
  }

  it('returns per-portal validation issues without downloading a package', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-VAL'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const listingId = randomUUID();

    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({ id: listingId, expected_stock_purchase_id: created.received.id })
      .expect(201);

    const validation = await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/listing/export/validate`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);

    expect(validation.body.channels).toHaveLength(3);
    const mobile = validation.body.channels.find(
      (row: { platform: string }) => row.platform === 'MOBILE_DE',
    );
    expect(mobile.serializer_supported).toBe(true);
    expect(mobile.issues.length).toBeGreaterThan(0);
  });

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
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
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

  it('returns 404 when the listing exists on another site in the same tenant', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-SITE'),
      sellerType: 'VENDOR',
    });
    await prepareActiveListing(created.received.vehicle_id, created.received.id);

    const otherSite = await suite.createAdditionalLotSite({
      code: 'LOT-B',
      grantMembership: true,
    });
    await setActiveSiteId(otherSite.site.id);

    const res = await request(suite.app.getHttpServer())
      .get(
        `/api/vehicle-stock/${created.received.vehicle_id}/listing/export/download?profile=MOBILE_DE_REFERENCE_V1`,
      )
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(404);

    expect(res.body.code ?? res.body.message).toBeTruthy();

    const mainSite = await suite.prisma.site.findFirstOrThrow({
      where: { tenant_id: suite.tenantId, code: 'MAIN' },
    });
    await setActiveSiteId(mainSite.id);
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
