import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { backfillTyreMeasurements } from '../src/tyre-measurement/tyre-measurement-backfill.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const legacyJson = (value: unknown) => value as Prisma.InputJsonValue;

describe('Tyre measurement backfill (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantA: { tenantId: string; token: string };
  let tenantB: { tenantId: string };
  let dbA: PrismaService;
  let dbB: PrismaService;
  let siteAId: string;
  let setAId: string;
  let eventAId: string;
  let noVehicleSetId: string;
  let emptySetId: string;
  let setBId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    const a = await createTestTenant(prisma, 'tyre-backfill-a');
    const b = await createTestTenant(prisma, 'tyre-backfill-b');
    tenantA = {
      tenantId: a.tenantId,
      token: createTestAuthToken(app.get(AuthService), a),
    };
    tenantB = { tenantId: b.tenantId };
    dbA = createTenantAwarePrisma(prisma, a.tenantId);
    dbB = createTenantAwarePrisma(prisma, b.tenantId);

    const mainSite = async (db: PrismaService) =>
      db.site.findFirstOrThrow({ where: { code: 'MAIN' } });
    const siteA = await mainSite(dbA);
    siteAId = siteA.id;
    const siteB = await mainSite(dbB);

    const customerA = await dbA.customer.create({
      data: {
        tenant_id: a.tenantId,
        type: 'PRIVATE',
        first_name: 'Pilot',
        last_name: 'Customer',
      },
    });
    const vehicleA = await dbA.vehicle.create({
      data: {
        tenant_id: a.tenantId,
        customer_id: customerA.id,
        make: 'Test',
        model: 'Synthetic',
        year: 2021,
        inventory_role: 'CUSTOMER',
      },
    });
    const locationA = await dbA.storageLocation.create({
      data: {
        tenant_id: a.tenantId,
        site_id: siteA.id,
        code: 'BACKFILL-RACK',
        name: 'Backfill rack',
        type: 'customer_storage',
      },
    });
    const setA = await dbA.tyreSet.create({
      data: {
        tenant_id: a.tenantId,
        customer_id: customerA.id,
        vehicle_id: vehicleA.id,
        site_id: siteA.id,
        location_id: locationA.id,
        label: 'Legacy set',
        season: 'WINTER',
        tread_depth_mm_json: legacyJson({
          FL: 4.5,
          fr: 'invalid',
          RL: null,
          SPARE: 3,
          EXTRA: 7,
        }),
      },
    });
    setAId = setA.id;
    eventAId = (
      await dbA.tyreSetEvent.create({
        data: {
          tenant_id: a.tenantId,
          tyre_set_id: setA.id,
          event_type: 'CHECK_IN',
          occurred_at: new Date('2026-01-10T10:00:00.000Z'),
          tread_depth_mm_json: legacyJson({ FL: 5, RR: 2 }),
        },
      })
    ).id;
    noVehicleSetId = (
      await dbA.tyreSet.create({
        data: {
          tenant_id: a.tenantId,
          customer_id: customerA.id,
          site_id: siteA.id,
          label: 'No vehicle',
          season: 'SUMMER',
          tread_depth_mm_json: legacyJson({ FL: 4 }),
        },
      })
    ).id;
    emptySetId = (
      await dbA.tyreSet.create({
        data: {
          tenant_id: a.tenantId,
          customer_id: customerA.id,
          vehicle_id: vehicleA.id,
          site_id: siteA.id,
          label: 'Unusable JSON',
          season: 'SUMMER',
          tread_depth_mm_json: legacyJson({ notAPosition: 'x' }),
        },
      })
    ).id;

    const customerB = await dbB.customer.create({
      data: {
        tenant_id: b.tenantId,
        type: 'PRIVATE',
        first_name: 'Other',
        last_name: 'Tenant',
      },
    });
    const vehicleB = await dbB.vehicle.create({
      data: {
        tenant_id: b.tenantId,
        customer_id: customerB.id,
        make: 'Test',
        model: 'Other',
        year: 2022,
        inventory_role: 'CUSTOMER',
      },
    });
    setBId = (
      await dbB.tyreSet.create({
        data: {
          tenant_id: b.tenantId,
          customer_id: customerB.id,
          vehicle_id: vehicleB.id,
          site_id: siteB.id,
          label: 'Other tenant',
          season: 'SUMMER',
          tread_depth_mm_json: legacyJson({ FL: 4 }),
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (tenantA) await cleanupTestTenantGraph(app.get(PrismaService), tenantA.tenantId);
    if (tenantB) await cleanupTestTenantGraph(app.get(PrismaService), tenantB.tenantId);
    if (app) await teardownTestApp(app);
  });

  it('backfills middle-point readings once, keeps legacy JSON and warns on unusable values', async () => {
    const dryRun = await backfillTyreMeasurements(prisma, {
      execute: false,
      tenantId: tenantA.tenantId,
    });
    expect(dryRun.setsConverted).toBe(1);
    expect(dryRun.eventsConverted).toBe(1);
    expect(
      await dbA.tyreMeasurement.count({ where: { tenant_id: tenantA.tenantId } }),
    ).toBe(0);

    const first = await backfillTyreMeasurements(prisma, {
      execute: true,
      tenantId: tenantA.tenantId,
    });
    expect(first.setsConverted).toBe(1);
    expect(first.eventsConverted).toBe(1);
    expect(first.setsSkippedNoVehicle).toBe(1);
    expect(first.setsSkippedNoReadings).toBe(1);
    expect(first.warnings).toBeGreaterThanOrEqual(3);

    const sets = await dbA.tyreMeasurement.findMany({
      where: {
        tenant_id: tenantA.tenantId,
        source: 'LEGACY_TREAD_JSON',
        tyre_set_id: { in: [setAId, noVehicleSetId, emptySetId] },
        tyre_set_event_id: null,
      },
      include: { wheels: { orderBy: { position: 'asc' } } },
      orderBy: { measured_at: 'asc' },
    });
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      tyre_set_id: setAId,
      site_id: siteAId,
      source_ref: `set:${setAId}`,
      tyre_set_event_id: null,
      measured_by: null,
      measured_by_name: 'Legacy tread backfill',
      country: 'AT',
      weight_class: 'UP_TO_3500_KG',
    });
    expect(sets[0].wheels.map((wheel) => wheel.position)).toEqual([
      'FL',
      'SPARE',
    ]);
    expect(sets[0].wheels.map((wheel) => Number(wheel.tread_middle_mm))).toEqual([
      4.5, 3,
    ]);
    for (const wheel of sets[0].wheels) {
      expect(wheel.tread_inner_mm).toBeNull();
      expect(wheel.tread_outer_mm).toBeNull();
      expect(wheel.evaluation).toMatchObject({ version: 1, state: 'EVALUATED' });
    }

    const events = await dbA.tyreMeasurement.findMany({
      where: {
        tenant_id: tenantA.tenantId,
        source: 'LEGACY_TREAD_JSON',
        tyre_set_event_id: { not: null },
      },
      include: { wheels: { orderBy: { position: 'asc' } } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source_ref: `event:${eventAId}`,
      tyre_set_id: setAId,
      tyre_set_event_id: eventAId,
      workshop_order_id: null,
    });
    expect(events[0].measured_at.toISOString()).toBe(
      '2026-01-10T10:00:00.000Z',
    );
    expect(events[0].wheels.map((wheel) => wheel.position)).toEqual([
      'FL',
      'RR',
    ]);

    const setRow = await dbA.tyreSet.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId, id: setAId },
    });
    expect(setRow.tread_depth_mm_json).toEqual({
      FL: 4.5,
      fr: 'invalid',
      RL: null,
      SPARE: 3,
      EXTRA: 7,
    });
    const eventRow = await dbA.tyreSetEvent.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId, id: eventAId },
    });
    expect(eventRow.tread_depth_mm_json).toEqual({ FL: 5, RR: 2 });

    const total = await dbA.tyreMeasurement.count({
      where: { tenant_id: tenantA.tenantId },
    });
    const second = await backfillTyreMeasurements(prisma, {
      execute: true,
      tenantId: tenantA.tenantId,
    });
    expect(second.setsConverted).toBe(0);
    expect(second.eventsConverted).toBe(0);
    expect(
      await dbA.tyreMeasurement.count({
        where: { tenant_id: tenantA.tenantId },
      }),
    ).toBe(total);

    const detail = await request(app.getHttpServer())
      .get(`/api/tyre-sets/${setAId}`)
      .set('Authorization', `Bearer ${tenantA.token}`)
      .expect(200);
    expect(detail.body.latestMeasurement).toMatchObject({
      source: 'LEGACY_TREAD_JSON',
      worstStatus: 'URGENT',
    });
  });

  it('never converts another tenant and leaves tenant B untouched until asked', async () => {
    expect(
      await dbB.tyreMeasurement.count({ where: { tenant_id: tenantB.tenantId } }),
    ).toBe(0);
    const result = await backfillTyreMeasurements(prisma, {
      execute: true,
      tenantId: tenantB.tenantId,
    });
    expect(result.setsConverted).toBe(1);
    const rows = await dbB.tyreMeasurement.findMany({
      where: { tenant_id: tenantB.tenantId, tyre_set_id: setBId },
    });
    expect(rows).toHaveLength(1);
    expect(
      await dbB.tyreSet.findFirstOrThrow({
        where: { tenant_id: tenantB.tenantId, id: setBId },
      }),
    ).toMatchObject({ tread_depth_mm_json: { FL: 4 } });
  });

  it('dates the set snapshot by recency and skips unsupported precision', async () => {
    const tenantC = await createTestTenant(prisma, 'tyre-backfill-c');
    const dbC = createTenantAwarePrisma(prisma, tenantC.tenantId);
    const token = createTestAuthToken(app.get(AuthService), tenantC);
    try {
      const site = await dbC.site.findFirstOrThrow({ where: { code: 'MAIN' } });
      const customer = await dbC.customer.create({
        data: {
          tenant_id: tenantC.tenantId,
          type: 'PRIVATE',
          first_name: 'Recency',
          last_name: 'Customer',
        },
      });
      const vehicle = await dbC.vehicle.create({
        data: {
          tenant_id: tenantC.tenantId,
          customer_id: customer.id,
          make: 'Test',
          model: 'Recency',
          year: 2023,
          inventory_role: 'CUSTOMER',
        },
      });
      const patched = await dbC.tyreSet.create({
        data: {
          tenant_id: tenantC.tenantId,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          site_id: site.id,
          label: 'Event then patch',
          season: 'WINTER',
          tread_depth_mm_json: legacyJson({ FL: 6 }),
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      });
      await dbC.tyreSetEvent.create({
        data: {
          tenant_id: tenantC.tenantId,
          tyre_set_id: patched.id,
          event_type: 'CHECK_IN',
          occurred_at: new Date('2026-04-10T10:00:00.000Z'),
          tread_depth_mm_json: legacyJson({ FL: 6 }),
        },
      });
      await request(app.getHttpServer())
        .patch(`/api/tyre-sets/${patched.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ treadDepthMm: { FL: 3 } })
        .expect(200);
      const precise = await dbC.tyreSet.create({
        data: {
          tenant_id: tenantC.tenantId,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          site_id: site.id,
          label: 'Unsupported precision',
          season: 'SUMMER',
          tread_depth_mm_json: legacyJson({ FL: 3.999 }),
        },
      });

      const result = await backfillTyreMeasurements(prisma, {
        execute: true,
        tenantId: tenantC.tenantId,
      });
      expect(result.setsConverted).toBe(1);
      expect(result.eventsConverted).toBe(1);
      expect(result.setsSkippedNoReadings).toBe(1);
      expect(result.warnings).toBeGreaterThanOrEqual(1);

      const setMeasurement = await dbC.tyreMeasurement.findFirstOrThrow({
        where: { tenant_id: tenantC.tenantId, source_ref: `set:${patched.id}` },
        include: { wheels: true },
      });
      const eventMeasurement = await dbC.tyreMeasurement.findFirstOrThrow({
        where: {
          tenant_id: tenantC.tenantId,
          source_ref: { startsWith: 'event:' },
        },
      });
      expect(setMeasurement.measured_at.getTime()).toBeGreaterThan(
        eventMeasurement.measured_at.getTime(),
      );
      expect(Number(setMeasurement.wheels[0].tread_middle_mm)).toBe(3);
      expect(setMeasurement.wheels[0].evaluation).toMatchObject({
        minimumTreadMm: 3,
      });

      expect(
        await dbC.tyreMeasurement.count({
          where: {
            tenant_id: tenantC.tenantId,
            source_ref: `set:${precise.id}`,
          },
        }),
      ).toBe(0);
      expect(
        await dbC.tyreSet.findFirstOrThrow({
          where: { tenant_id: tenantC.tenantId, id: precise.id },
        }),
      ).toMatchObject({ tread_depth_mm_json: { FL: 3.999 } });

      const detail = await request(app.getHttpServer())
        .get(`/api/tyre-sets/${patched.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.latestMeasurement).toMatchObject({
        sourceRef: `set:${patched.id}`,
        worstStatus: 'URGENT',
      });
      expect(detail.body.latestMeasurement.wheels[0].treadMiddleMm).toBe(3);
    } finally {
      await cleanupTestTenantGraph(app.get(PrismaService), tenantC.tenantId);
    }
  });

  it('keeps a live capture ahead of an approximate set snapshot', async () => {
    const tenantD = await createTestTenant(prisma, 'tyre-backfill-d');
    const dbD = createTenantAwarePrisma(prisma, tenantD.tenantId);
    const token = createTestAuthToken(app.get(AuthService), tenantD);
    try {
      const site = await dbD.site.findFirstOrThrow({ where: { code: 'MAIN' } });
      const customer = await dbD.customer.create({
        data: {
          tenant_id: tenantD.tenantId,
          type: 'PRIVATE',
          first_name: 'Live',
          last_name: 'Evidence',
        },
      });
      const vehicle = await dbD.vehicle.create({
        data: {
          tenant_id: tenantD.tenantId,
          customer_id: customer.id,
          make: 'Test',
          model: 'Evidence',
          year: 2024,
          inventory_role: 'CUSTOMER',
        },
      });
      const location = await dbD.storageLocation.create({
        data: {
          tenant_id: tenantD.tenantId,
          site_id: site.id,
          code: 'LIVE-RACK',
          name: 'Live rack',
          type: 'customer_storage',
        },
      });
      const set = await dbD.tyreSet.create({
        data: {
          tenant_id: tenantD.tenantId,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          site_id: site.id,
          location_id: location.id,
          label: 'Captured before backfill',
          season: 'WINTER',
          tread_depth_mm_json: legacyJson({ FL: 6 }),
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      });

      const inspection = await request(app.getHttpServer())
        .post(`/api/tyre-sets/${set.id}/inspect`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          wheels: [
            {
              position: 'FL',
              treadInnerMm: 3,
              treadMiddleMm: 3,
              treadOuterMm: 3,
              season: 'WINTER',
            },
          ],
        })
        .expect(200);
      expect(inspection.body.latestMeasurement).toMatchObject({
        source: 'CAPTURE',
        worstStatus: 'URGENT',
      });

      const result = await backfillTyreMeasurements(prisma, {
        execute: true,
        tenantId: tenantD.tenantId,
      });
      expect(result.setsConverted).toBe(0);
      expect(result.setsSkippedLiveMeasurements).toBe(1);
      expect(result.warnings).toBeGreaterThanOrEqual(1);

      expect(
        await dbD.tyreMeasurement.count({
          where: {
            tenant_id: tenantD.tenantId,
            source: 'LEGACY_TREAD_JSON',
          },
        }),
      ).toBe(0);
      expect(
        await dbD.tyreSet.findFirstOrThrow({
          where: { tenant_id: tenantD.tenantId, id: set.id },
        }),
      ).toMatchObject({ tread_depth_mm_json: { FL: 6 } });

      const detail = await request(app.getHttpServer())
        .get(`/api/tyre-sets/${set.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.latestMeasurement).toMatchObject({
        source: 'CAPTURE',
        worstStatus: 'URGENT',
      });
      expect(detail.body.latestMeasurement.wheels[0].treadMiddleMm).toBe(3);
    } finally {
      await cleanupTestTenantGraph(app.get(PrismaService), tenantD.tenantId);
    }
  });

  it('keeps a live capture ahead of a legacy payload on the same event', async () => {
    const tenantE = await createTestTenant(prisma, 'tyre-backfill-e');
    const dbE = createTenantAwarePrisma(prisma, tenantE.tenantId);
    const token = createTestAuthToken(app.get(AuthService), tenantE);
    try {
      const site = await dbE.site.findFirstOrThrow({ where: { code: 'MAIN' } });
      const customer = await dbE.customer.create({
        data: {
          tenant_id: tenantE.tenantId,
          type: 'PRIVATE',
          first_name: 'Dual',
          last_name: 'Payload',
        },
      });
      const vehicle = await dbE.vehicle.create({
        data: {
          tenant_id: tenantE.tenantId,
          customer_id: customer.id,
          make: 'Test',
          model: 'Payload',
          year: 2024,
          inventory_role: 'CUSTOMER',
        },
      });
      const location = await dbE.storageLocation.create({
        data: {
          tenant_id: tenantE.tenantId,
          site_id: site.id,
          code: 'DUAL-RACK',
          name: 'Dual rack',
          type: 'customer_storage',
        },
      });
      const set = await dbE.tyreSet.create({
        data: {
          tenant_id: tenantE.tenantId,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          site_id: site.id,
          location_id: location.id,
          label: 'Dual payload',
          season: 'WINTER',
        },
      });

      const inspection = await request(app.getHttpServer())
        .post(`/api/tyre-sets/${set.id}/inspect`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          treadDepthMm: { FL: 6 },
          wheels: [
            {
              position: 'FL',
              treadInnerMm: 3,
              treadMiddleMm: 6,
              treadOuterMm: 6,
              season: 'WINTER',
            },
          ],
        })
        .expect(200);
      expect(inspection.body.latestMeasurement).toMatchObject({
        source: 'CAPTURE',
        worstStatus: 'URGENT',
      });

      const result = await backfillTyreMeasurements(prisma, {
        execute: true,
        tenantId: tenantE.tenantId,
      });
      expect(result.eventsConverted).toBe(0);
      expect(result.eventsSkippedLiveMeasurements).toBe(1);
      expect(result.warnings).toBeGreaterThanOrEqual(1);

      expect(
        await dbE.tyreMeasurement.count({
          where: {
            tenant_id: tenantE.tenantId,
            source: 'LEGACY_TREAD_JSON',
          },
        }),
      ).toBe(0);
      const event = await dbE.tyreSetEvent.findFirstOrThrow({
        where: { tenant_id: tenantE.tenantId, tyre_set_id: set.id },
      });
      expect(event.tread_depth_mm_json).toEqual({ FL: 6 });

      const detail = await request(app.getHttpServer())
        .get(`/api/tyre-sets/${set.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.latestMeasurement).toMatchObject({
        source: 'CAPTURE',
        worstStatus: 'URGENT',
      });
      expect(detail.body.latestMeasurement.wheels[0].treadMiddleMm).toBe(6);
    } finally {
      await cleanupTestTenantGraph(app.get(PrismaService), tenantE.tenantId);
    }
  });
});
