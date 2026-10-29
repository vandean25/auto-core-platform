import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const wheel = {
  position: 'FL',
  treadInnerMm: 3.5,
  treadMiddleMm: 4,
  treadOuterMm: 4,
  season: 'SUMMER',
  brand: 'Test tyre',
  model: 'Synthetic',
  size: '205/55 R16',
};
const capture = { wheels: [wheel] };
const calendar = {
  summerSwapMonth: 3,
  summerSwapDay: 1,
  winterSwapMonth: 10,
  winterSwapDay: 1,
  dueForSwapDays: 30,
};

async function createFixture(app: INestApplication, prefix: string) {
  const base = app.get(PrismaService);
  const tenant = await createTestTenant(base, prefix);
  const db = createTenantAwarePrisma(base, tenant.tenantId);
  const site = await db.site.findFirstOrThrow({
    where: { tenant_id: tenant.tenantId, code: 'MAIN' },
  });
  const user = await base.user.findUniqueOrThrow({
    where: { firebaseUid: tenant.firebaseUid },
  });
  const vehicle = await db.vehicle.create({
    data: {
      tenant_id: tenant.tenantId,
      make: 'Test',
      model: 'Synthetic',
      year: 2026,
    },
  });
  const order = await db.workshopOrder.create({
    data: {
      tenant_id: tenant.tenantId,
      site_id: site.id,
      vehicle_id: vehicle.id,
      order_number: 'WO-TEST',
      odometer: 100,
      fuel_level: 50,
    },
  });
  const checkIn = await db.workshopCheckIn.create({
    data: {
      tenant_id: tenant.tenantId,
      workshop_order_id: order.id,
      odometer: 100,
      fuel_level: 50,
    },
  });
  return {
    ...tenant,
    db,
    site,
    user,
    vehicle,
    order,
    checkIn,
    token: createTestAuthToken(app.get(AuthService), tenant),
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

describe('Tyre measurements (e2e)', () => {
  let app: INestApplication;
  let a: Fixture;
  let b: Fixture;
  let branchId: string;
  let branchOrderId: string;
  let mediaId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    a = await createFixture(app, 'tyre-measurement-a');
    b = await createFixture(app, 'tyre-measurement-b');
    const branch = await a.db.site.create({
      data: {
        tenant_id: a.tenantId,
        legal_entity_id: a.site.legal_entity_id,
        code: 'BRANCH',
        name: 'Test branch',
      },
    });
    branchId = branch.id;
    branchOrderId = (
      await a.db.workshopOrder.create({
        data: {
          tenant_id: a.tenantId,
          site_id: branch.id,
          vehicle_id: a.vehicle.id,
          order_number: 'WO-BRANCH',
          odometer: 100,
          fuel_level: 50,
        },
      })
    ).id;
    const employee = await a.db.employee.create({
      data: {
        tenant_id: a.tenantId,
        name: 'Test Mechanic',
        role: 'MECHANIC',
      },
    });
    mediaId = (
      await a.db.workshopMedia.create({
        data: {
          tenant_id: a.tenantId,
          workshop_order_id: a.order.id,
          check_in_id: a.checkIn.id,
          purpose: 'CHECK_IN',
          uploaded_by_employee_id: employee.id,
          storage_bucket: 'synthetic',
          storage_key: 'synthetic-tyre.jpg',
          url_strategy: 'SIGNED',
          mime_type: 'image/jpeg',
          size_bytes: 100,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (a) await cleanupTestTenantGraph(app.get(PrismaService), a.tenantId);
    if (b) await cleanupTestTenantGraph(app.get(PrismaService), b.tenantId);
    if (app) await teardownTestApp(app);
  });

  const post = (path: string, body: object, token?: string) =>
    request(app.getHttpServer())
      .post(`/api/${path}`)
      .set('Authorization', `Bearer ${token ?? a.token}`)
      .send(body);
  const get = (path: string, token?: string) =>
    request(app.getHttpServer())
      .get(`/api/${path}`)
      .set('Authorization', `Bearer ${token ?? a.token}`);
  const settings = (overrides?: object) =>
    request(app.getHttpServer())
      .put('/api/tyre-sets/settings')
      .set('Authorization', `Bearer ${a.token}`)
      .send({
        ...calendar,
        ...(overrides === undefined
          ? {}
          : { recommendationOverrides: overrides }),
      });

  it('captures mixed wheels with raw facts and immutable evaluations', async () => {
    const created = await post(
      `workshop-orders/${a.order.id}/tyre-measurements`,
      {
        wheels: [
          wheel,
          {
            ...wheel,
            position: 'FR',
            season: 'WINTER',
            treadInnerMm: 3.5,
            dot: '239',
          },
        ],
      },
    ).expect(201);
    expect(created.body).toMatchObject({
      vehicleId: a.vehicle.id,
      siteId: a.site.id,
      country: 'AT',
      weightClass: 'UP_TO_3500_KG',
      weightClassSource: 'DEFAULT',
      measuredBy: a.user.id,
      measuredByName: a.email,
    });
    expect(created.body.wheels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...wheel,
          evaluation: expect.objectContaining({ status: 'GOOD' }),
        }),
        expect.objectContaining({
          position: 'FR',
          evaluation: expect.objectContaining({
            status: 'URGENT',
            reasonCodes: expect.arrayContaining([
              'AT_WINTER_TREAD_INSUFFICIENT',
              'DOT_LEGACY_OVER_20_YEARS',
            ]),
          }),
        }),
      ]),
    );
    await settings({ AT_SUMMER_LIGHT: { recommendedBelowMm: 4 } }).expect(200);
    const saved = await get(`tyre-measurements/${created.body.id}`).expect(200);
    expect(saved.body).toEqual(created.body);
    const newer = await post(
      `workshop-orders/${a.order.id}/tyre-measurements`,
      capture,
    ).expect(201);
    expect(newer.body.wheels[0].evaluation.status).toBe('RECOMMENDED');
    await settings().expect(200);
    expect(
      (await get('tyre-sets/settings')).body.recommendationOverrides,
    ).toEqual({ AT_SUMMER_LIGHT: { recommendedBelowMm: 4 } });
    await settings({}).expect(200);
  });

  it('captures check-in photos and lists by both parent routes with pagination', async () => {
    const created = await post(
      `workshop-check-ins/${a.checkIn.id}/tyre-measurements`,
      {
        wheels: [{ ...wheel, mediaId }],
        weightClass: 'OVER_3500_KG',
      },
    ).expect(201);
    expect(created.body).toMatchObject({
      checkInId: a.checkIn.id,
      workshopOrderId: a.order.id,
      weightClass: 'OVER_3500_KG',
      weightClassSource: 'CAPTURE',
    });
    expect(created.body.wheels[0].mediaId).toBe(mediaId);
    for (const parent of [
      `workshop-check-ins/${a.checkIn.id}`,
      `workshop-orders/${a.order.id}`,
    ]) {
      const response = await get(
        `${parent}/tyre-measurements?limit=1&page=1`,
      ).expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toMatchObject({ page: 1, pageSize: 1 });
    }
  });

  it('allows TECH capture but not threshold settings updates', async () => {
    await a.db.tenantMember.updateMany({
      where: { tenant_id: a.tenantId, user_id: a.user.id },
      data: { role: 'TECH' },
    });
    try {
      await post(
        `workshop-orders/${a.order.id}/tyre-measurements`,
        capture,
      ).expect(201);
      await settings({}).expect(403);
    } finally {
      await a.db.tenantMember.updateMany({
        where: { tenant_id: a.tenantId, user_id: a.user.id },
        data: { role: 'ADMIN' },
      });
    }
  });

  it('hides foreign-tenant and other-site parents and measurement details', async () => {
    const result = await post(
      `workshop-orders/${a.order.id}/tyre-measurements`,
      capture,
    ).expect(201);
    await get(`tyre-measurements/${result.body.id}`, b.token).expect(404);
    await post(
      `workshop-orders/${a.order.id}/tyre-measurements`,
      capture,
      b.token,
    ).expect(404);
    await get(
      `workshop-check-ins/${a.checkIn.id}/tyre-measurements`,
      b.token,
    ).expect(404);
    await post(
      `workshop-orders/${branchOrderId}/tyre-measurements`,
      capture,
    ).expect(404);
    await get(`workshop-orders/${branchOrderId}/tyre-measurements`).expect(404);
  });

  it('requires an active authorized site', async () => {
    await app.get(PrismaService).user.update({
      where: { id: a.user.id },
      data: { active_site_id: null },
    });
    try {
      await post(
        `workshop-orders/${a.order.id}/tyre-measurements`,
        capture,
      ).expect(422);
    } finally {
      await app.get(PrismaService).user.update({
        where: { id: a.user.id },
        data: { active_site_id: a.site.id },
      });
    }
    await a.db.site.updateMany({
      where: { tenant_id: a.tenantId, id: a.site.id },
      data: { is_active: false },
    });
    try {
      await get(`workshop-orders/${a.order.id}/tyre-measurements`).expect(422);
    } finally {
      await a.db.site.updateMany({
        where: { tenant_id: a.tenantId, id: a.site.id },
        data: { is_active: true },
      });
    }
  });

  it.each([
    { wheels: [] },
    { wheels: [wheel, wheel] },
    { wheels: [{ ...wheel, treadInnerMm: -1 }] },
    { wheels: [{ ...wheel, treadOuterMm: 21 }] },
    { wheels: [{ ...wheel, dot: '0020' }] },
    { wheels: [{ ...wheel, dot: '0127' }] },
    { wheels: [{ ...wheel, dot: '14320' }] },
    { wheels: [{ ...wheel, dot: 'DOT ABC4120' }] },
    { wheels: [wheel], measuredAt: '2099-01-01T00:00:00Z' },
  ])('rejects invalid capture without partial writes: %j', async (body) => {
    const before = await get(
      `workshop-orders/${a.order.id}/tyre-measurements`,
    ).expect(200);
    await post(`workshop-orders/${a.order.id}/tyre-measurements`, body).expect(
      400,
    );
    const after = await get(
      `workshop-orders/${a.order.id}/tyre-measurements`,
    ).expect(200);
    expect(after.body.meta.total).toBe(before.body.meta.total);
  });

  it('returns a stable DOT error code', async () => {
    const result = await post(
      `workshop-orders/${a.order.id}/tyre-measurements`,
      { wheels: [{ ...wheel, dot: '0020' }] },
    ).expect(400);
    expect(result.body).toMatchObject({ code: 'TYRE_DOT_INVALID_WEEK' });
  });

  it('retains legacy age evidence when the identifier ends with a digit', async () => {
    const result = await post(
      `workshop-orders/${a.order.id}/tyre-measurements`,
      {
        wheels: [{ ...wheel, dot: 'DOT ABC4 120' }],
      },
    ).expect(201);
    expect(result.body.wheels[0].evaluation).toMatchObject({
      status: 'RECOMMENDED',
      reasonCodes: expect.arrayContaining(['DOT_LEGACY_OVER_20_YEARS']),
      dot: {
        format: 'LEGACY_PRE_2000',
        productionWeek: 12,
        productionYear: null,
        productionDate: null,
        ageMonths: null,
      },
    });
  });

  it('rejects mismatched, orphan and non-check-in media', async () => {
    await post(
      `workshop-orders/${b.order.id}/tyre-measurements`,
      { wheels: [{ ...wheel, mediaId }] },
      b.token,
    ).expect(404);
    for (const data of [
      { check_in_id: null },
      { purpose: 'GENERAL' as const },
      { mime_type: 'application/pdf' },
    ]) {
      await a.db.workshopMedia.updateMany({
        where: { tenant_id: a.tenantId, id: mediaId },
        data,
      });
      try {
        await post(`workshop-check-ins/${a.checkIn.id}/tyre-measurements`, {
          wheels: [{ ...wheel, mediaId }],
        }).expect(404);
      } finally {
        await a.db.workshopMedia.updateMany({
          where: { tenant_id: a.tenantId, id: mediaId },
          data: {
            check_in_id: a.checkIn.id,
            purpose: 'CHECK_IN',
            mime_type: 'image/jpeg',
          },
        });
      }
    }
  });

  it('rejects weaker recommendations and legal-threshold changes', async () => {
    await settings({ AT_SUMMER_LIGHT: { recommendedBelowMm: 2 } }).expect(400);
    await settings({
      AT_SUMMER_LIGHT: { recommendedBelowMm: 4, legalMinimumMm: 1 },
    }).expect(400);
  });

  it('keeps tyre-hotel writes out of T1 and does not modify legacy JSON', async () => {
    const customer = await a.db.customer.create({
      data: {
        tenant_id: a.tenantId,
        type: 'PRIVATE',
        first_name: 'Pilot',
        last_name: 'Customer',
      },
    });
    const tyreSet = await a.db.tyreSet.create({
      data: {
        tenant_id: a.tenantId,
        site_id: a.site.id,
        customer_id: customer.id,
        vehicle_id: a.vehicle.id,
        label: 'Synthetic',
        season: 'SUMMER',
        tread_depth_mm_json: { FL: 5 },
      },
    });
    const event = await a.db.tyreSetEvent.create({
      data: {
        tenant_id: a.tenantId,
        tyre_set_id: tyreSet.id,
        event_type: 'CHECK_IN',
        occurred_at: new Date(),
        tread_depth_mm_json: { FL: 6 },
      },
    });
    await post(`workshop-orders/${a.order.id}/tyre-measurements`, {
      ...capture,
      tyreSetId: tyreSet.id,
    }).expect(201);
    await get(`tyre-set-events/${event.id}/tyre-measurements`).expect(200, {
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, pageCount: 0 },
    });
    await post(`tyre-set-events/${event.id}/tyre-measurements`, capture).expect(
      404,
    );
    expect(
      (
        await a.db.tyreSet.findFirstOrThrow({
          where: { tenant_id: a.tenantId, id: tyreSet.id },
        })
      ).tread_depth_mm_json,
    ).toEqual({ FL: 5 });
    expect(
      (
        await a.db.tyreSetEvent.findFirstOrThrow({
          where: { tenant_id: a.tenantId, id: event.id },
        })
      ).tread_depth_mm_json,
    ).toEqual({ FL: 6 });
    const otherVehicle = await a.db.vehicle.create({
      data: { tenant_id: a.tenantId, make: 'Test', model: 'Other', year: 2026 },
    });
    for (const vehicleId of [otherVehicle.id, null]) {
      await expect(
        a.db.tyreSet.updateMany({
          where: { tenant_id: a.tenantId, id: tyreSet.id },
          data: { vehicle_id: vehicleId },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    }
  });

  it('enforces composite tenant and parent constraints at the database boundary', async () => {
    const data = {
      tenant_id: a.tenantId,
      site_id: a.site.id,
      vehicle_id: a.vehicle.id,
      workshop_order_id: a.order.id,
      measured_at: new Date(),
      measured_by_name: 'Test author',
      country: 'AT',
    };
    await expect(
      a.db.tyreMeasurement.create({
        data: { ...data, vehicle_id: b.vehicle.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      a.db.tyreMeasurement.create({
        data: { ...data, check_in_id: b.checkIn.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      a.db.tyreMeasurement.create({
        data: { ...data, workshop_order_id: branchOrderId },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      a.db.tyreMeasurement.create({
        data: { ...data, workshop_order_id: null, check_in_id: a.checkIn.id },
      }),
    ).rejects.toThrow();
    await expect(
      a.db.tyreMeasurement.create({
        data: { ...data, tyre_set_event_id: b.checkIn.id },
      }),
    ).rejects.toThrow();
  });

  it('enforces unique wheel positions and pins referenced media', async () => {
    const result = await post(
      `workshop-check-ins/${a.checkIn.id}/tyre-measurements`,
      { wheels: [{ ...wheel, mediaId }] },
    ).expect(201);
    const data = {
      tenant_id: a.tenantId,
      measurement_id: result.body.id as string,
      position: 'FL' as const,
      season: 'SUMMER' as const,
      tread_inner_mm: 4,
      tread_middle_mm: 4,
      tread_outer_mm: 4,
      evaluation: {},
    };
    await expect(a.db.tyreWheelReading.create({ data })).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(
      b.db.tyreWheelReading.create({
        data: { ...data, tenant_id: b.tenantId, position: 'RR' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      a.db.tyreWheelReading.create({
        data: { ...data, position: 'RR', tread_inner_mm: -1 },
      }),
    ).rejects.toThrow();
    await expect(
      a.db.workshopMedia.deleteMany({
        where: { tenant_id: a.tenantId, id: mediaId },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects ungranted DEMO sessions and inactive site membership', async () => {
    await a.db.tenantMember.updateMany({
      where: { tenant_id: a.tenantId, user_id: a.user.id },
      data: { role: 'DEMO' },
    });
    try {
      await post(
        `workshop-orders/${a.order.id}/tyre-measurements`,
        capture,
      ).expect(401);
      await get(`workshop-orders/${a.order.id}/tyre-measurements`).expect(401);
    } finally {
      await a.db.tenantMember.updateMany({
        where: { tenant_id: a.tenantId, user_id: a.user.id },
        data: { role: 'ADMIN' },
      });
    }
    await a.db.siteMembership.updateMany({
      where: { tenant_id: a.tenantId, user_id: a.user.id },
      data: { is_active: false },
    });
    try {
      await get(`workshop-orders/${a.order.id}/tyre-measurements`).expect(422);
    } finally {
      await a.db.siteMembership.updateMany({
        where: { tenant_id: a.tenantId, user_id: a.user.id },
        data: { is_active: true },
      });
    }
  });

  it('retains author history after membership removal and blocks captured-order retargeting', async () => {
    const result = await post(
      `workshop-orders/${a.order.id}/tyre-measurements`,
      capture,
    ).expect(201);
    await expect(
      a.db.workshopOrder.updateMany({
        where: { tenant_id: a.tenantId, id: a.order.id },
        data: { site_id: branchId },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await a.db.siteMembership.deleteMany({
      where: { tenant_id: a.tenantId, user_id: a.user.id },
    });
    await a.db.tenantMember.deleteMany({
      where: { tenant_id: a.tenantId, user_id: a.user.id },
    });
    await a.db.tenantMember.create({
      data: { tenant_id: a.tenantId, user_id: a.user.id, role: 'ADMIN' },
    });
    await a.db.siteMembership.create({
      data: { tenant_id: a.tenantId, site_id: a.site.id, user_id: a.user.id },
    });
    const saved = await get(`tyre-measurements/${result.body.id}`).expect(200);
    expect(saved.body.measuredByName).toBe(a.email);
  });
});
