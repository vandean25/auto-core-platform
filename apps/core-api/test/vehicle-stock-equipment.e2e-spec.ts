import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { seedVehicleEquipmentOptions } from '../src/vehicle/equipment/seed-vehicle-equipment-options.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';
import {
  createTestAuthToken,
  seedTestTenantMember,
} from './tenant-test-utils.js';

describe('Vehicle stock equipment (e2e)', () => {
  let suite: Awaited<ReturnType<typeof createVehicleStockSuite>>;

  beforeAll(async () => {
    suite = await createVehicleStockSuite();
    await seedVehicleEquipmentOptions(suite.prisma, suite.tenantId);
  });

  afterAll(async () => {
    await disposeVehicleStockSuite(suite);
  });

  it('lists options, replaces equipment on the active site, and isolates stock cycles', async () => {
    const created = await suite.createAndReceive({
      vin: vin('EQ-1'),
      sellerType: 'VENDOR',
    });
    const vehicleId = created.received.vehicle_id;

    await request(suite.app.getHttpServer())
      .get('/api/vehicle-equipment-options?page=10abc')
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(400);

    const optionsRes = await request(suite.app.getHttpServer())
      .get('/api/vehicle-equipment-options')
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);

    const abs = optionsRes.body.data.find(
      (row: { code: string }) => row.code === 'ABS',
    );
    expect(abs).toBeDefined();

    const putRes = await request(suite.app.getHttpServer())
      .put(`/api/vehicle-stock/${vehicleId}/equipment`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({
        selections: [{ option_id: abs.id, assertion: 'PRESENT' }],
        free_text_lines: ['Panoramic roof'],
      })
      .expect(200);

    expect(putRes.body).toMatchObject({
      stock_purchase_id: created.received.id,
      selections: [
        {
          assertion: 'PRESENT',
          option: { code: 'ABS' },
        },
      ],
      free_text_items: [{ text: 'Panoramic roof' }],
    });

    const getRes = await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${vehicleId}/equipment`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);
    expect(getRes.body.free_text_items).toHaveLength(1);
  });

  it('returns 404 for a foreign tenant vehicle and 403 for TECH PUT', async () => {
    const local = await suite.createAndReceive({
      vin: vin('EQ-2A'),
      sellerType: 'VENDOR',
    });

    await request(suite.app.getHttpServer())
      .get(`/api/vehicle-stock/${local.received.vehicle_id}/equipment`)
      .set('Authorization', `Bearer ${suite.otherAuthToken}`)
      .expect(404);

    const techFirebaseUid = `tech-equipment-${suite.tenantId}`;
    const techUser = await suite.basePrisma.user.create({
      data: {
        firebaseUid: techFirebaseUid,
        email: `tech-equipment-${suite.tenantId}@example.com`,
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
      .put(`/api/vehicle-stock/${local.received.vehicle_id}/equipment`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ selections: [], free_text_lines: [] })
      .expect(403);

    await request(suite.app.getHttpServer())
      .put(`/api/vehicle-stock/${local.received.vehicle_id}/equipment`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .send({})
      .expect(400);
  });
});
