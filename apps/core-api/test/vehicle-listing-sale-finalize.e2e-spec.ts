import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { VehicleListingExportState } from '@prisma/client';
import { VEHICLE_MEDIA_STORAGE } from '../src/vehicle-stock/vehicle-media/vehicle-media.storage.js';
import { registerVehicleMediaPurgeStorage } from '../src/vehicle-stock/vehicle-media/vehicle-media-purge.registry.js';
import { InMemoryVehicleMediaStorage } from './support/in-memory-vehicle-media-storage.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';

describe('Vehicle listing on sale finalize (e2e)', () => {
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

  async function prepareExportedMobileListing(
    vehicleId: string,
    stockPurchaseId: string,
  ) {
    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({ id: randomUUID(), expected_stock_purchase_id: stockPurchaseId })
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
        description: 'Sale finalize listing fixture.',
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

    await request(suite.app.getHttpServer())
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
  }

  it('finalizes sale to REMOVAL_REQUIRED and blocks export download afterward', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-SALE'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    await prepareExportedMobileListing(vehicleId, created.received.id);

    const saleRes = await request(suite.app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        vehicle_id: vehicleId,
        customer_id: suite.buyerId,
        sale_price: 12000,
      })
      .expect(201);

    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-sales/${saleRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(201);

    const channel = await suite.prisma.vehicleListingChannel.findFirstOrThrow({
      where: {
        listing: {
          vehicle_id: vehicleId,
          stock_purchase_id: created.received.id,
        },
        platform: 'MOBILE_DE',
      },
    });
    expect(channel.desired_state).toBe('INACTIVE');
    expect(channel.export_state).toBe(
      VehicleListingExportState.REMOVAL_REQUIRED,
    );
    expect(channel.removal_revision).toBeGreaterThanOrEqual(1);

    const download = await request(suite.app.getHttpServer())
      .get(
        `/api/vehicle-stock/${vehicleId}/listing/export/download?profile=MOBILE_DE_REFERENCE_V1`,
      )
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(422);

    expect(download.body.code).toBe('VEHICLE_LISTING_NOT_READY');
  });

  it('deactivates the listing after a cross-site move before sale', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-MOVE'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const originalSiteId = created.received.site_id as string;
    await prepareExportedMobileListing(vehicleId, created.received.id);

    const vehicle = await suite.prisma.vehicle.findFirstOrThrow({
      where: { id: vehicleId },
    });
    const target = await suite.createAdditionalLotSite({
      code: 'SALE-MOVE',
      grantMembership: true,
    });

    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/move-site`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        toSiteId: target.site.id,
        toLocationId: target.lot.id,
        expectedLocationId: vehicle.location_id,
      })
      .expect(201);

    await setActiveSiteId(target.site.id);

    const saleRes = await request(suite.app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        vehicle_id: vehicleId,
        customer_id: suite.buyerId,
        sale_price: 12000,
      })
      .expect(201);

    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-sales/${saleRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(201);

    const listing = await suite.prisma.vehicleListing.findFirstOrThrow({
      where: {
        vehicle_id: vehicleId,
        stock_purchase_id: created.received.id,
      },
    });
    expect(listing.site_id).toBe(originalSiteId);

    const channel = await suite.prisma.vehicleListingChannel.findFirstOrThrow({
      where: { listing_id: listing.id, platform: 'MOBILE_DE' },
    });
    expect(channel.desired_state).toBe('INACTIVE');
    expect(channel.export_state).toBe(
      VehicleListingExportState.REMOVAL_REQUIRED,
    );

    const mainSite = await suite.prisma.site.findFirstOrThrow({
      where: { tenant_id: suite.tenantId, code: 'MAIN' },
    });
    await setActiveSiteId(mainSite.id);
  });
});
