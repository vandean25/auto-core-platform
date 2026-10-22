import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { VehicleListingExportState } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service.js';
import { seedVehicleEquipmentOptions } from '../src/vehicle/equipment/seed-vehicle-equipment-options.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';
import { seedTestTenantMember } from './tenant-test-utils.js';
import { createTestAuthToken } from './tenant-test-utils.js';

describe('Vehicle stock listing (e2e)', () => {
  let suite: Awaited<ReturnType<typeof createVehicleStockSuite>>;

  async function setActiveSiteId(siteId: string) {
    const user = await suite.basePrisma.user.findFirstOrThrow({
      where: { firebaseUid: `e2e-user-${suite.tenantId}` },
    });
    await suite.basePrisma.user.update({
      where: { id: user.id },
      data: { active_site_id: siteId },
    });
  }

  function createListing(
    vehicleId: string,
    body: { id: string; expected_stock_purchase_id: string },
  ) {
    return request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send(body)
      .expect(201);
  }

  beforeAll(async () => {
    suite = await createVehicleStockSuite();
    await seedVehicleEquipmentOptions(suite.prisma, suite.tenantId);
  });

  afterAll(async () => {
    await disposeVehicleStockSuite(suite);
  });

  it('creates, patches, and updates channel state for the active stock cycle', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-1'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const listingId = randomUUID();

    const postRes = await createListing(vehicleId, {
      id: listingId,
      expected_stock_purchase_id: created.received.id,
    });

    expect(postRes.body.listing_ref).toMatch(/^L[0-9a-f]{32}$/i);
    expect(postRes.body.channels).toHaveLength(3);
    expect(postRes.body.revision).toBe(1);

    const patchRes = await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 1,
        description: 'Synthetic used-car listing description.',
        price_gross_eur: 14500,
        vat_display: 'STANDARD',
        nova_included_confirmed: true,
        mandatory_fees_included_confirmed: true,
      })
      .expect(200);

    expect(patchRes.body.revision).toBe(2);
    expect(patchRes.body.price_display.consumer_hint_de).toBe(
      'inkl. USt. und NoVA',
    );
    const channelRes = await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing/channels/MOBILE_DE`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 2,
        desired_state: 'ACTIVE',
      })
      .expect(200);

    expect(
      channelRes.body.channels.find(
        (row: { platform: string }) => row.platform === 'MOBILE_DE',
      )?.desired_state,
    ).toBe('ACTIVE');
    expect(channelRes.body.revision).toBe(3);
    expect(channelRes.body.content_sha256).toBe(patchRes.body.content_sha256);

    await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);
  });

  it('rejects ACTIVE channel when listing readiness is incomplete', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-NR'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const listingId = randomUUID();

    await createListing(vehicleId, {
      id: listingId,
      expected_stock_purchase_id: created.received.id,
    });

    await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 1,
        description: 'Draft without price or VAT confirmations.',
      })
      .expect(200);

    const notReady = await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing/channels/MOBILE_DE`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 2,
        desired_state: 'ACTIVE',
      })
      .expect(422);

    expect(notReady.body.code).toBe('VEHICLE_LISTING_NOT_READY');
  });

  it('rejects ACTIVE when NoVA or mandatory-fee confirmations are missing', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-NR2'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;

    await createListing(vehicleId, {
      id: randomUUID(),
      expected_stock_purchase_id: created.received.id,
    });

    await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 1,
        description: 'Price set but confirmations missing.',
        price_gross_eur: 9900,
        vat_display: 'STANDARD',
        nova_included_confirmed: false,
        mandatory_fees_included_confirmed: false,
      })
      .expect(200);

    const notReady = await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing/channels/AS24`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 2,
        desired_state: 'ACTIVE',
      })
      .expect(422);

    expect(notReady.body.code).toBe('VEHICLE_LISTING_NOT_READY');
  });

  it('returns 409 when expected_revision is stale on listing patch', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-REV'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;

    await createListing(vehicleId, {
      id: randomUUID(),
      expected_stock_purchase_id: created.received.id,
    });

    await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 1,
        description: 'First concurrent writer wins.',
      })
      .expect(200);

    const conflict = await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 1,
        description: 'Second writer with stale revision.',
      })
      .expect(409);

    expect(conflict.body.code).toBe('VEHICLE_LISTING_REVISION_CONFLICT');
  });

  it('includes equipment saved before create in the initial content_sha256', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-PRE'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;

    const optionsRes = await request(suite.app.getHttpServer())
      .get('/api/vehicle-equipment-options')
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);
    const abs = optionsRes.body.data.find(
      (row: { code: string }) => row.code === 'ABS',
    );

    await request(suite.app.getHttpServer())
      .put(`/api/vehicle-stock/${vehicleId}/equipment`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        selections: [{ option_id: abs.id, assertion: 'ABSENT' }],
        free_text_lines: ['Tow bar'],
      })
      .expect(200);

    const withEquipment = await createListing(vehicleId, {
      id: randomUUID(),
      expected_stock_purchase_id: created.received.id,
    });

    const bare = await suite.createAndReceive({
      vin: vin('LST-BARE'),
      sellerType: 'VENDOR',
    });
    const bareListing = await createListing(bare.received.vehicle_id, {
      id: randomUUID(),
      expected_stock_purchase_id: bare.received.id,
    });

    expect(withEquipment.body.content_sha256).not.toBe(
      bareListing.body.content_sha256,
    );
  });

  it('recomputes content_sha256 when vehicle color changes on stock patch', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-COL'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;

    await createListing(vehicleId, {
      id: randomUUID(),
      expected_stock_purchase_id: created.received.id,
    });

    const before = await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);

    await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({ color: 'Alpine White' })
      .expect(200);

    const after = await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);

    expect(after.body.content_sha256).not.toBe(before.body.content_sha256);
    expect(after.body.revision).toBeGreaterThan(before.body.revision);
  });

  it('recomputes content_sha256 when equipment changes on the stock cycle', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-EQ'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const listingId = randomUUID();

    await createListing(vehicleId, {
      id: listingId,
      expected_stock_purchase_id: created.received.id,
    });

    const patched = await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 1,
        description: 'Listing before equipment sync.',
      })
      .expect(200);

    const optionsRes = await request(suite.app.getHttpServer())
      .get('/api/vehicle-equipment-options')
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);
    const abs = optionsRes.body.data.find(
      (row: { code: string }) => row.code === 'ABS',
    );

    await request(suite.app.getHttpServer())
      .put(`/api/vehicle-stock/${vehicleId}/equipment`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        selections: [{ option_id: abs.id, assertion: 'ABSENT' }],
        free_text_lines: ['Heated seats'],
      })
      .expect(200);

    const afterEquipment = await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);

    expect(afterEquipment.body.content_sha256).not.toBe(
      patched.body.content_sha256,
    );
    expect(afterEquipment.body.revision).toBeGreaterThan(patched.body.revision);
  });

  it('does not mark FILE_GENERATED dirty when a listing patch leaves the hash unchanged', async () => {
    const created = await suite.createAndReceive({
      vin: vin('LST-HASH'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;

    await createListing(vehicleId, {
      id: randomUUID(),
      expected_stock_purchase_id: created.received.id,
    });

    const patched = await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 1,
        description: 'Stable export payload.',
      })
      .expect(200);

    const listingRow = await suite.prisma.vehicleListing.findFirstOrThrow({
      where: { tenant_id: suite.tenantId, vehicle_id: vehicleId },
      select: { id: true },
    });
    await suite.prisma.vehicleListingChannel.updateMany({
      where: {
        tenant_id: suite.tenantId,
        listing_id: listingRow.id,
      },
      data: { export_state: VehicleListingExportState.FILE_GENERATED },
    });

    const noopPatch = await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: patched.body.revision,
        description: 'Stable export payload.',
      })
      .expect(200);

    expect(noopPatch.body.content_sha256).toBe(patched.body.content_sha256);
    const channel = await suite.prisma.vehicleListingChannel.findFirstOrThrow({
      where: {
        tenant_id: suite.tenantId,
        listing_id: listingRow.id,
        platform: 'MOBILE_DE',
      },
      select: { export_state: true },
    });
    expect(channel.export_state).toBe(VehicleListingExportState.FILE_GENERATED);
  });

  it('scopes listing GET and idempotent create to the active site after a stock move', async () => {
    const user = await suite.basePrisma.user.findFirstOrThrow({
      where: { firebaseUid: `e2e-user-${suite.tenantId}` },
    });
    const mainSiteId = user.active_site_id!;

    const created = await suite.createAndReceive({
      vin: vin('LST-SITE'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;
    const listingId = randomUUID();

    await createListing(vehicleId, {
      id: listingId,
      expected_stock_purchase_id: created.received.id,
    });

    const vehicle = await suite.prisma.vehicle.findFirstOrThrow({
      where: { id: vehicleId },
    });
    const target = await suite.createAdditionalLotSite({
      code: 'LIST-MOVE',
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

    await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(404);

    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        id: listingId,
        expected_stock_purchase_id: created.received.id,
      })
      .expect(404);

    await setActiveSiteId(mainSiteId);
  });

  it('returns 404 for foreign tenant and 403 for TECH POST', async () => {
    const local = await suite.createAndReceive({
      vin: vin('LST-2'),
      sellerType: 'VENDOR',
    });

    await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${local.received.vehicle_id}/listing`)
      .set('Authorization', `Bearer ${suite.otherAuthToken}`)
      .expect(404);

    const techFirebaseUid = `tech-listing-${suite.tenantId}`;
    const techUser = await suite.basePrisma.user.create({
      data: {
        firebaseUid: techFirebaseUid,
        email: `tech-listing-${suite.tenantId}@example.com`,
      },
    });
    await seedTestTenantMember(suite.basePrisma, {
      tenantId: suite.tenantId,
      userId: techUser.id,
      role: 'TECH',
    });
    const techToken = createTestAuthToken(suite.app.get(AuthService), {
      tenantId: suite.tenantId,
      firebaseUid: techFirebaseUid,
      email: techUser.email,
      role: 'TECH',
    });

    await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${local.received.vehicle_id}/listing`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        id: randomUUID(),
        expected_stock_purchase_id: local.received.id,
      })
      .expect(403);
  });
});
