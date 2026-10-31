import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSetMatchesEventLedger } from '../src/tyre-storage/tyre-set-event.helpers.js';
import { evaluateTyreWheel } from '../src/tyre-measurement/tyre-evaluation.js';
import { TyreStorageClock } from '../src/tyre-storage/tyre-storage.clock.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Tyre storage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: PrismaService;
  let authToken: string;
  let otherAuthToken: string;
  let tenantId: string;
  let userId: string;
  let siteId: string;
  let customerId: string;
  let vehicleId: string;
  let storageLocationId: string;
  let storageLocation2Id: string;
  let storageLocation3Id: string;
  let otherSiteLocationId: string;
  let branchSiteId: string;

  beforeAll(async () => {
    app = await createE2eApp();

    const basePrisma = app.get(PrismaService);
    const tenant = await createTestTenant(basePrisma, 'tyre-storage');
    tenantId = tenant.tenantId;
    tenantPrisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), tenant);

    const otherTenant = await createTestTenant(basePrisma, 'tyre-storage-b');
    otherAuthToken = createTestAuthToken(app.get(AuthService), otherTenant);

    prisma = basePrisma;
    userId = (
      await basePrisma.user.findUniqueOrThrow({
        where: { firebaseUid: tenant.firebaseUid },
        select: { id: true },
      })
    ).id;

    const site = await tenantPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenantId, code: 'MAIN' },
    });
    siteId = site.id;

    const customer = await tenantPrisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Pilot',
        last_name: 'Customer',
        email: `pilot-${tenantId}@example.com`,
        type: 'PRIVATE',
        phone: '+43123456789',
      },
    });
    customerId = customer.id;

    const vehicle = await tenantPrisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        make: 'VW',
        model: 'Golf',
        year: 2020,
        plate: 'W-TEST-1',
        inventory_role: 'CUSTOMER',
      },
    });
    vehicleId = vehicle.id;

    const location = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        code: 'TYRE-RACK',
        name: 'Tyre rack',
        type: 'customer_storage',
      },
    });
    storageLocationId = location.id;

    storageLocation2Id = (
      await tenantPrisma.storageLocation.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          code: 'TYRE-RACK-2',
          name: 'Tyre rack 2',
          type: 'customer_storage',
        },
      })
    ).id;

    storageLocation3Id = (
      await tenantPrisma.storageLocation.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          code: 'TYRE-RACK-3',
          name: 'Tyre rack 3',
          type: 'customer_storage',
        },
      })
    ).id;

    const secondSite = await tenantPrisma.site.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: (
          await tenantPrisma.legalEntity.findFirstOrThrow({
            where: { tenant_id: tenantId },
          })
        ).id,
        code: 'BRANCH',
        name: 'Branch site',
        is_active: true,
      },
    });
    branchSiteId = secondSite.id;
    otherSiteLocationId = (
      await tenantPrisma.storageLocation.create({
        data: {
          tenant_id: tenantId,
          site_id: secondSite.id,
          code: 'OTHER-RACK',
          name: 'Other rack',
          type: 'customer_storage',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantId);
    await teardownTestApp(app);
  });

  it('creates a set, records events, and keeps state aligned with the ledger', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        locationId: storageLocationId,
        label: 'Winter 18"',
        season: 'WINTER',
        binLabel: 'R3-F2-07',
      })
      .expect(201);

    const setId = createRes.body.id;
    expect(createRes.body.status).toBe('IN_STORAGE');

    await request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/check-out`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ locationId: storageLocationId })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ locationId: storageLocationId })
      .expect(409);

    const detail = await tenantPrisma.tyreSet.findFirstOrThrow({
      where: { id: setId, tenant_id: tenantId },
    });
    const events = await tenantPrisma.tyreSetEvent.findMany({
      where: { tenant_id: tenantId, tyre_set_id: setId },
      orderBy: { occurred_at: 'asc' },
    });
    assertSetMatchesEventLedger(detail, events);
  });

  it('creates a new tyre set without location as NEW, excludes from due list, and supports check-in', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        label: 'Brand New Summer',
        season: 'SUMMER',
      })
      .expect(201);

    const setId = createRes.body.id;
    expect(createRes.body.status).toBe('NEW');
    expect(createRes.body.locationId).toBeNull();
    expect(createRes.body.storedSince).toBeNull();

    const dueRes = await request(app.getHttpServer())
      .get('/api/tyre-sets/due-for-swap')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(dueRes.body.data.some((row: { id: string }) => row.id === setId)).toBe(false);

    const checkInRes = await request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ locationId: storageLocationId })
      .expect(200);
    expect(checkInRes.body.status).toBe('IN_STORAGE');
    expect(checkInRes.body.locationId).toBe(storageLocationId);

    const checkOutRes = await request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/check-out`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(200);
    expect(checkOutRes.body.status).toBe('RETURNED');
    expect(checkOutRes.body.locationId).toBeNull();
  });

  it('rejects storage locations from another site', async () => {
    await request(app.getHttpServer())
      .post('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        locationId: otherSiteLocationId,
        label: 'Summer set',
        season: 'SUMMER',
      })
      .expect(422);
  });

  it('hides sets from other tenants', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        locationId: storageLocationId,
        label: 'Hidden set',
        season: 'ALL_SEASON',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/tyre-sets/${createRes.body.id}`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);
  });

  async function seedDueSet(label: string, plannedSwapOn: string) {
    return tenantPrisma.tyreSet.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        site_id: siteId,
        location_id: storageLocationId,
        label,
        season: 'WINTER',
        status: 'IN_STORAGE',
        planned_swap_on: new Date(plannedSwapOn),
      },
    });
  }

  async function dueIds(): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/api/tyre-sets/due-for-swap')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    return res.body.data.map((row: { id: string }) => row.id);
  }

  it('lists due-for-swap with clock override around season boundaries', async () => {
    const clock = app.get(TyreStorageClock);
    const dueSet = await seedDueSet('Due winter', '2026-03-01T00:00:00.000Z');
    await seedDueSet('Not yet due', '2026-10-01T00:00:00.000Z');

    clock.setOverride(new Date('2026-01-29T12:00:00.000Z'));
    expect(await dueIds()).not.toContain(dueSet.id);

    clock.setOverride(new Date('2026-01-30T12:00:00.000Z'));
    expect(await dueIds()).toContain(dueSet.id);

    clock.setOverride(new Date('2026-03-01T12:00:00.000Z'));
    const onSwapDay = await dueIds();
    expect(onSwapDay).toContain(dueSet.id);
    expect(onSwapDay[0]).toBe(dueSet.id);

    clock.setOverride(new Date('2026-06-01T12:00:00.000Z'));
    expect(await dueIds()).toContain(dueSet.id);

    const res = await request(app.getHttpServer())
      .get('/api/tyre-sets/due-for-swap')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(res.body.data[0].customerPhone).toBeTruthy();

    clock.setOverride(null);
  });

  it('derives planned swap across year rollover when creating with clock override', async () => {
    const clock = app.get(TyreStorageClock);
    clock.setOverride(new Date('2026-12-15T12:00:00.000Z'));

    const createRes = await request(app.getHttpServer())
      .post('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        locationId: storageLocationId,
        label: 'Summer rollover',
        season: 'SUMMER',
      })
      .expect(201);

    clock.setOverride(null);

    expect(createRes.body.plannedSwapOn).toBe('2027-10-01');
  });

  it('isolates sets by active site', async () => {
    const branchSet = await tenantPrisma.tyreSet.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        vehicle_id: vehicleId,
        site_id: branchSiteId,
        location_id: otherSiteLocationId,
        label: 'Branch only',
        season: 'WINTER',
        status: 'IN_STORAGE',
        planned_swap_on: new Date('2026-03-01'),
      },
    });

    await request(app.getHttpServer())
      .get(`/api/tyre-sets/${branchSet.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/tyre-sets/${branchSet.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ label: 'Nope' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/tyre-sets/${branchSet.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    for (const path of ['check-out', 'check-in', 'move', 'dispose', 'inspect']) {
      await request(app.getHttpServer())
        .post(`/api/tyre-sets/${branchSet.id}/${path}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(
          path === 'check-in' || path === 'move'
            ? { locationId: storageLocationId }
            : {},
        )
        .expect(404);
    }

    const list = await request(app.getHttpServer())
      .get('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(list.body.data.some((row: { id: string }) => row.id === branchSet.id)).toBe(
      false,
    );

    const due = await request(app.getHttpServer())
      .get('/api/tyre-sets/due-for-swap')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(due.body.data.some((row: { id: string }) => row.id === branchSet.id)).toBe(
      false,
    );

    const byVehicle = await request(app.getHttpServer())
      .get(`/api/tyre-sets/by-vehicle/${vehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(
      byVehicle.body.data.some((row: { id: string }) => row.id === branchSet.id),
    ).toBe(false);
  });

  it('rejects concurrent moves with 409', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        locationId: storageLocationId,
        label: 'Move race',
        season: 'ALL_SEASON',
      })
      .expect(201);

    const setId = createRes.body.id;
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/tyre-sets/${setId}/move`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ locationId: storageLocation2Id }),
      request(app.getHttpServer())
        .post(`/api/tyre-sets/${setId}/move`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ locationId: storageLocation3Id }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('rejects check-in after dispose with 409', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        locationId: storageLocationId,
        label: 'Dispose me',
        season: 'WINTER',
      })
      .expect(201);

    const setId = createRes.body.id;
    await request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/dispose`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ locationId: storageLocationId })
      .expect(409);
  });

  it('rejects backdated storage events with 422', async () => {
    const clock = app.get(TyreStorageClock);
    clock.setOverride(new Date('2026-06-01T12:00:00.000Z'));

    const createRes = await request(app.getHttpServer())
      .post('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        locationId: storageLocationId,
        label: 'Timeline',
        season: 'WINTER',
      })
      .expect(201);

    const setId = createRes.body.id;
    clock.setOverride(new Date('2026-06-15T12:00:00.000Z'));

    await request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/check-out`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ occurredAt: '2026-06-10T12:00:00.000Z' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        locationId: storageLocationId,
        occurredAt: '2026-06-05T12:00:00.000Z',
      })
      .expect(422);

    clock.setOverride(null);
  });

  const wheelAt = (position: string, mm: number) => ({
    position,
    treadInnerMm: mm,
    treadMiddleMm: mm,
    treadOuterMm: mm,
    season: 'WINTER',
  });

  async function createMeasuredSet(label: string, vehicle: string | null) {
    const res = await request(app.getHttpServer())
      .post('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId: vehicle,
        locationId: storageLocationId,
        label,
        season: 'WINTER',
      })
      .expect(201);
    return res.body;
  }

  const setAction = (setId: string, action: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/tyre-sets/${setId}/${action}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);

  it('records measurements on check-in, check-out and inspection and shows the latest', async () => {
    const created = await createMeasuredSet('Measured set', vehicleId);
    expect(created.latestMeasurement).toBeNull();
    const setId = created.id;

    const checkOut = await setAction(setId, 'check-out', {
      wheels: [
        wheelAt('FL', 4),
        wheelAt('FR', 4),
        wheelAt('RL', 3.2),
        wheelAt('RR', 3.2),
      ],
    }).expect(200);
    expect(checkOut.body.latestMeasurement).toMatchObject({
      tyreSetId: setId,
      vehicleId,
      workshopOrderId: null,
      source: 'CAPTURE',
      worstStatus: 'URGENT',
    });
    expect(checkOut.body.latestMeasurement.wheels).toHaveLength(4);

    const checkIn = await setAction(setId, 'check-in', {
      locationId: storageLocationId,
      wheels: [wheelAt('FL', 6)],
    }).expect(200);
    expect(checkIn.body.latestMeasurement).toMatchObject({
      worstStatus: 'GOOD',
    });
    expect(checkIn.body.latestMeasurement.wheels).toHaveLength(1);

    const inspected = await setAction(setId, 'inspect', {
      wheels: [wheelAt('FR', 2.5)],
    }).expect(200);
    expect(inspected.body.latestMeasurement).toMatchObject({
      tyreSetId: setId,
      worstStatus: 'URGENT',
    });
    expect(inspected.body.latestMeasurement.wheels[0]).toMatchObject({
      position: 'FR',
      treadMiddleMm: 2.5,
      evaluation: expect.objectContaining({ status: 'URGENT' }),
    });

    const measurements = await tenantPrisma.tyreMeasurement.findMany({
      where: { tenant_id: tenantId, tyre_set_id: setId },
      include: { wheels: true },
      orderBy: { measured_at: 'asc' },
    });
    expect(measurements).toHaveLength(3);
    expect(measurements[0].tyre_set_event_id).toBeTruthy();
    expect(measurements[0].workshop_order_id).toBeNull();
    expect(
      measurements.every(
        (row) =>
          row.vehicle_id === vehicleId &&
          row.site_id === siteId &&
          row.source === 'CAPTURE',
      ),
    ).toBe(true);

    const list = await request(app.getHttpServer())
      .get('/api/tyre-sets')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const row = list.body.data.find((item: { id: string }) => item.id === setId);
    expect(row.latestMeasurement.id).toBe(inspected.body.latestMeasurement.id);

    const plain = await createMeasuredSet('No readings', vehicleId);
    await setAction(plain.id, 'check-out', {}).expect(200);
    expect(
      await tenantPrisma.tyreMeasurement.count({
        where: { tenant_id: tenantId, tyre_set_id: plain.id },
      }),
    ).toBe(0);
  });

  it('prefers the newest capture when measurement times tie', async () => {
    const created = await createMeasuredSet('Tie break', vehicleId);
    const measuredAt = new Date('2026-07-01T08:00:00.000Z');
    const evaluationContext = {
      country: 'AT',
      weightClass: 'UP_TO_3500_KG' as const,
      asOf: measuredAt,
      overrides: {},
    };
    const wheel = (mm: number) => ({
      position: 'FL' as const,
      tread_inner_mm: mm,
      tread_middle_mm: mm,
      tread_outer_mm: mm,
      season: 'WINTER' as const,
      construction: 'RADIAL' as const,
      winter_marking: 'NONE' as const,
      evaluation: evaluateTyreWheel(
        {
          treadInnerMm: mm,
          treadMiddleMm: mm,
          treadOuterMm: mm,
          season: 'WINTER',
          dot: null,
        },
        evaluationContext,
      ),
    });
    const measurement = (id: string, mm: number, createdAt: Date) => ({
      id,
      tenant_id: tenantId,
      site_id: siteId,
      vehicle_id: vehicleId,
      tyre_set_id: created.id,
      measured_at: measuredAt,
      measured_by_name: 'Tie test',
      country: 'AT',
      weight_class: 'UP_TO_3500_KG' as const,
      weight_class_source: 'DEFAULT' as const,
      source: 'CAPTURE' as const,
      createdAt,
      wheels: { create: [wheel(mm)] },
    });
    await tenantPrisma.tyreMeasurement.create({
      data: measurement(
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        6,
        new Date('2026-07-01T08:00:01.000Z'),
      ),
    });
    await tenantPrisma.tyreMeasurement.create({
      data: measurement(
        '00000000-0000-4000-8000-000000000000',
        2,
        new Date('2026-07-01T08:00:02.000Z'),
      ),
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/tyre-sets/${created.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(detail.body.latestMeasurement).toMatchObject({
      id: '00000000-0000-4000-8000-000000000000',
      worstStatus: 'URGENT',
    });
  });

  it('records an explicit heavy weight class on hotel captures', async () => {
    const created = await createMeasuredSet('Heavy capture', vehicleId);
    const inspected = await setAction(created.id, 'inspect', {
      wheels: [wheelAt('FL', 4.5)],
      weightClass: 'OVER_3500_KG',
    }).expect(200);
    expect(inspected.body.latestMeasurement).toMatchObject({
      weightClass: 'OVER_3500_KG',
      weightClassSource: 'CAPTURE',
      worstStatus: 'URGENT',
    });
  });

  it('links an event measurement to the workshop order and rejects mismatched parents', async () => {
    const created = await createMeasuredSet('Order linked', vehicleId);
    const order = await tenantPrisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: vehicleId,
        order_number: `WO-TYRE-${created.id.slice(0, 8)}`,
        odometer: 100,
        fuel_level: 50,
      },
    });
    const res = await setAction(created.id, 'check-out', {
      workshopOrderId: order.id,
      wheels: [wheelAt('RL', 5)],
    }).expect(200);
    expect(res.body.latestMeasurement.workshopOrderId).toBe(order.id);

    const otherVehicle = await tenantPrisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        make: 'Test',
        model: 'Other',
        year: 2020,
        inventory_role: 'CUSTOMER',
      },
    });
    const otherOrder = await tenantPrisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: otherVehicle.id,
        order_number: `WO-OTHER-${created.id.slice(0, 8)}`,
        odometer: 100,
        fuel_level: 50,
      },
    });
    const other = await createMeasuredSet('Mismatch', vehicleId);
    await setAction(other.id, 'check-out', {
      workshopOrderId: otherOrder.id,
      wheels: [wheelAt('FL', 5)],
    }).expect(422);
    expect(
      await tenantPrisma.tyreMeasurement.count({
        where: { tenant_id: tenantId, tyre_set_id: other.id },
      }),
    ).toBe(0);
  });

  it('rejects readings on unsupported events and sets without a vehicle', async () => {
    const created = await createMeasuredSet('Moved with readings', vehicleId);
    const moved = await setAction(created.id, 'move', {
      locationId: storageLocation2Id,
      wheels: [wheelAt('FL', 5)],
    }).expect(400);
    expect(moved.body.code).toBe('TYRE_MEASUREMENT_EVENT_INVALID');

    const noVehicle = await createMeasuredSet('No vehicle', null);
    const rejected = await setAction(noVehicle.id, 'check-out', {
      wheels: [wheelAt('FL', 5)],
    }).expect(422);
    expect(rejected.body.code).toBe('TYRE_MEASUREMENT_VEHICLE_REQUIRED');

    const media = await setAction(created.id, 'check-out', {
      wheels: [{ ...wheelAt('FL', 5), mediaId: '00000000-0000-4000-8000-000000000000' }],
    }).expect(400);
    expect(media.body.code).toBe('TYRE_MEASUREMENT_MEDIA_INVALID');
  });

  it('lets TECH inspect with readings but not check sets in or out', async () => {
    const created = await createMeasuredSet('TECH inspect', vehicleId);
    await tenantPrisma.tenantMember.updateMany({
      where: { tenant_id: tenantId, user_id: userId },
      data: { role: 'TECH' },
    });
    try {
      await setAction(created.id, 'check-in', {
        locationId: storageLocationId,
      }).expect(403);
      await setAction(created.id, 'check-out', {
        wheels: [wheelAt('FL', 5)],
      }).expect(403);
      const inspected = await setAction(created.id, 'inspect', {
        wheels: [wheelAt('FL', 5)],
      }).expect(200);
      expect(inspected.body.latestMeasurement.tyreSetId).toBe(created.id);
    } finally {
      await tenantPrisma.tenantMember.updateMany({
        where: { tenant_id: tenantId, user_id: userId },
        data: { role: 'ADMIN' },
      });
    }
  });

  it('does not let another tenant inspect or read hotel measurements', async () => {
    const created = await createMeasuredSet('Isolated', vehicleId);
    await setAction(created.id, 'inspect', {
      wheels: [wheelAt('FL', 5)],
    }).expect(200);
    await request(app.getHttpServer())
      .post(`/api/tyre-sets/${created.id}/inspect`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .send({ wheels: [wheelAt('FL', 3)] })
      .expect(404);
    expect(
      await tenantPrisma.tyreMeasurement.count({
        where: { tenant_id: tenantId, tyre_set_id: created.id },
      }),
    ).toBe(1);
  });
});
