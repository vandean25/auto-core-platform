import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSetMatchesEventLedger } from '../src/tyre-storage/tyre-set-event.helpers.js';
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
  let siteId: string;
  let customerId: string;
  let vehicleId: string;
  let storageLocationId: string;
  let otherSiteLocationId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    const basePrisma = app.get(PrismaService);
    const tenant = await createTestTenant(basePrisma, 'tyre-storage');
    tenantId = tenant.tenantId;
    tenantPrisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), tenant);

    const otherTenant = await createTestTenant(basePrisma, 'tyre-storage-b');
    otherAuthToken = createTestAuthToken(app.get(AuthService), otherTenant);

    prisma = basePrisma;

    const site = await tenantPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenantId, code: 'MAIN' },
    });
    siteId = site.id;

    const customer = await tenantPrisma.customer.create({
      data: {
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

  async function dueIds(asOf: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/api/tyre-sets/due-for-swap')
      .query({ asOf })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    return res.body.data.map((row: { id: string }) => row.id);
  }

  it('lists due-for-swap with injected asOf around season boundaries', async () => {
    const dueSet = await seedDueSet('Due winter', '2026-03-01T00:00:00.000Z');
    await seedDueSet('Not yet due', '2026-10-01T00:00:00.000Z');

    const dayBeforeWindow = await dueIds('2026-01-29T12:00:00.000Z');
    expect(dayBeforeWindow).not.toContain(dueSet.id);

    const firstDayInside = await dueIds('2026-01-30T12:00:00.000Z');
    expect(firstDayInside).toContain(dueSet.id);

    const onSwapDay = await dueIds('2026-03-01T12:00:00.000Z');
    expect(onSwapDay).toContain(dueSet.id);

    const overdue = await dueIds('2026-06-01T12:00:00.000Z');
    expect(overdue).toContain(dueSet.id);
    expect(overdue[0]).toBe(dueSet.id);

    const res = await request(app.getHttpServer())
      .get('/api/tyre-sets/due-for-swap')
      .query({ asOf: '2026-03-01T12:00:00.000Z' })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.data[0].customerPhone).toBeTruthy();
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
});
