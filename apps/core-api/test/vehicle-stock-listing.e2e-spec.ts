import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';
import { seedTestTenantMember } from './tenant-test-utils.js';
import { createTestAuthToken } from './tenant-test-utils.js';

describe('Vehicle stock listing (e2e)', () => {
  let suite: Awaited<ReturnType<typeof createVehicleStockSuite>>;

  beforeAll(async () => {
    suite = await createVehicleStockSuite();
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

    const postRes = await request(suite.app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        id: listingId,
        expected_stock_purchase_id: created.received.id,
      })
      .expect(201);

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
    const hashAfterPatch = patchRes.body.content_sha256;

    const channelRes = await request(suite.app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}/listing/channels/MOBILE_DE`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        expected_revision: 2,
        desired_state: 'ACTIVE',
      })
      .expect(200);

    expect(channelRes.body.channels.find(
      (row: { platform: string }) => row.platform === 'MOBILE_DE',
    )?.desired_state).toBe('ACTIVE');
    expect(channelRes.body.content_sha256).not.toBe(hashAfterPatch);

    await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/listing`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);
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

    const techUser = await suite.basePrisma.user.create({
      data: {
        firebaseUid: `tech-listing-${suite.tenantId}`,
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
      firebaseUid: techUser.firebaseUid,
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
