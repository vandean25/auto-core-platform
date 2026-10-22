import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';
import type { VehicleStockSuite } from './helpers/vehicle-stock-suite.js';

describe('Vehicle stock trading (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let authToken: string;
  let otherAuthToken: string;
  let buyerId: string;
  let createAndReceive: VehicleStockSuite['createAndReceive'];
  let createAdditionalLotSite: VehicleStockSuite['createAdditionalLotSite'];

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      otherTenantId,
      authToken,
      otherAuthToken,
      buyerId,
      createAndReceive,
      createAdditionalLotSite,
    } = await createVehicleStockSuite());
  });

  afterAll(async () => {
    await disposeVehicleStockSuite({
      app,
      basePrisma,
      prisma,
      tenantId,
      otherTenantId,
    });
  });

  it('returns 404 for a vehicle from another tenant', async () => {
    const { received } = await createAndReceive({
      vin: vin('XTE01'),
      sellerType: 'VENDOR',
    });

    await request(app.getHttpServer())
      .get(`/api/vehicle-stock/${received.vehicle_id}`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);
  });

  it('requires an active site for stock vehicle detail', async () => {
    const { received } = await createAndReceive({
      vin: vin('NOSITE1'),
      sellerType: 'VENDOR',
    });
    const user = await basePrisma.user.findFirstOrThrow({
      where: { firebaseUid: `e2e-user-${tenantId}` },
    });
    const activeSiteId = user.active_site_id;

    try {
      await basePrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: null },
      });

      await request(app.getHttpServer())
        .get(`/api/vehicle-stock/${received.vehicle_id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(422);
    } finally {
      await basePrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: activeSiteId },
      });
    }
  });

  it('moves a stock vehicle to an authorized lot in the same legal entity', async () => {
    const { received } = await createAndReceive({
      vin: vin('MOVE01'),
      sellerType: 'VENDOR',
    });
    const vehicle = await prisma.vehicle.findFirstOrThrow({
      where: { id: received.vehicle_id },
    });
    const target = await createAdditionalLotSite({
      code: 'MOVE-TARGET',
      grantMembership: true,
    });

    const moved = await request(app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicle.id}/move-site`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        toSiteId: target.site.id,
        toLocationId: target.lot.id,
        expectedLocationId: vehicle.location_id,
      })
      .expect(201);

    expect(moved.body.location_id).toBe(target.lot.id);
  });

  it('rejects a cross-site move without target-site membership', async () => {
    const { received } = await createAndReceive({
      vin: vin('MOVE02'),
      sellerType: 'VENDOR',
    });
    const vehicle = await prisma.vehicle.findFirstOrThrow({
      where: { id: received.vehicle_id },
    });
    const target = await createAdditionalLotSite({ code: 'NO-GRANT' });

    await request(app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicle.id}/move-site`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        toSiteId: target.site.id,
        toLocationId: target.lot.id,
        expectedLocationId: vehicle.location_id,
      })
      .expect(422);
  });

  it('rejects a vehicle move across legal entities', async () => {
    const { received } = await createAndReceive({
      vin: vin('MOVE03'),
      sellerType: 'VENDOR',
    });
    const vehicle = await prisma.vehicle.findFirstOrThrow({
      where: { id: received.vehicle_id },
    });
    const target = await createAdditionalLotSite({
      code: 'OTHER-GMBH',
      grantMembership: true,
      separateLegalEntity: true,
    });

    await request(app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicle.id}/move-site`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        toSiteId: target.site.id,
        toLocationId: target.lot.id,
        expectedLocationId: vehicle.location_id,
      })
      .expect(422);
  });

  it('rejects a vehicle move to an inactive site', async () => {
    const { received } = await createAndReceive({
      vin: vin('MOVE04'),
      sellerType: 'VENDOR',
    });
    const vehicle = await prisma.vehicle.findFirstOrThrow({
      where: { id: received.vehicle_id },
    });
    const target = await createAdditionalLotSite({
      code: 'INACTIVE-MOVE',
      isActive: false,
      grantMembership: true,
    });

    await request(app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicle.id}/move-site`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        toSiteId: target.site.id,
        toLocationId: target.lot.id,
        expectedLocationId: vehicle.location_id,
      })
      .expect(422);
  });

  it('redacts dealer operational fields outside the caller lot sites', async () => {
    const hidden = await createAdditionalLotSite({ code: 'HIDDEN-STOCK' });
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Volkswagen',
        model: 'Hidden Golf',
        year: 2021,
        vin: vin('HIDDEN1'),
        customer_id: buyerId,
        inventory_role: 'USED',
        stock_status: 'RESERVED',
        site_id: hidden.site.id,
        location_id: hidden.lot.id,
        reserved_for_customer_id: buyerId,
      },
    });

    const vehicleDetail = await request(app.getHttpServer())
      .get(`/api/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(vehicleDetail.body.location_id ?? null).toBeNull();
    expect(vehicleDetail.body.site_id ?? null).toBeNull();
    expect(vehicleDetail.body.stock_status ?? null).toBeNull();
    expect(vehicleDetail.body.inventory_role ?? null).toBeNull();
    expect(vehicleDetail.body.reserved_for_customer_id ?? null).toBeNull();

    const customerDetail = await request(app.getHttpServer())
      .get(`/api/customers/${buyerId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const projectedVehicle = customerDetail.body.vehicles.find(
      (item: { id: string }) => item.id === vehicle.id,
    );

    expect(projectedVehicle.location_id ?? null).toBeNull();
    expect(projectedVehicle.site_id ?? null).toBeNull();
    expect(projectedVehicle.stock_status ?? null).toBeNull();
    expect(projectedVehicle.inventory_role ?? null).toBeNull();
    expect(projectedVehicle.reserved_for_customer_id ?? null).toBeNull();

    const hiddenList = await request(app.getHttpServer())
      .get('/api/vehicle-stock')
      .query({ search: vin('HIDDEN1') })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(hiddenList.body.data).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicle.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ mileage: 123 })
      .expect(404);
  });

  it('returns 404 for customer and unparked vehicles in vehicle stock detail', async () => {
    const customerVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Volkswagen',
        model: 'Customer Golf',
        year: 2020,
        vin: vin('CUSTOMER-DETAIL'),
        customer_id: buyerId,
        inventory_role: 'CUSTOMER',
      },
    });
    const unparkedVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Volkswagen',
        model: 'Unparked Golf',
        year: 2020,
        vin: vin('UNPARKED-DETAIL'),
        inventory_role: 'USED',
        stock_status: 'IN_STOCK',
      },
    });

    await request(app.getHttpServer())
      .get(`/api/vehicle-stock/${customerVehicle.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/vehicle-stock/${unparkedVehicle.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });

  it('rejects stale same-site and cross-site vehicle move expectations', async () => {
    const { received } = await createAndReceive({
      vin: vin('STALE-PATCH'),
      sellerType: 'VENDOR',
    });
    const vehicle = await prisma.vehicle.findFirstOrThrow({
      where: { id: received.vehicle_id },
    });
    const sameSiteLot = await prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: vehicle.site_id!,
        code: 'STALE-PATCH-LOT',
        name: 'Stale Patch Lot',
        type: 'vehicle_lot',
      },
    });

    await request(app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicle.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ location_id: sameSiteLot.id, expectedLocationId: vehicle.id })
      .expect(409);

    const target = await createAdditionalLotSite({
      code: 'STALE-MOVE',
      grantMembership: true,
    });
    await request(app.getHttpServer())
      .post(`/api/vehicle-stock/${vehicle.id}/move-site`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        toSiteId: target.site.id,
        toLocationId: target.lot.id,
        expectedLocationId: vehicle.id,
      })
      .expect(409);
  });
});
