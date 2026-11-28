import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { SCOPE_CONTEXT_HEADER } from '../src/auth/scope-context/scope-context.constants.js';
import { decodeListCursor } from '../src/common/list-cursor/list-cursor.codec.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import { scopedListRequest } from './helpers/list-scope-context.js';
import {
  cleanupTestTenantGraph,
  createMemberBearer,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const VEHICLES = '/api/vehicles';
const COUNT = '/api/vehicles/capped-count';

describe('Customer vehicles cursor list (AUT-957 e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenant: TestTenantResult;
  let bearer: string;
  let scopeContext: string;
  let vehicleSeq = 0;
  const originalTz = process.env.TZ;

  beforeAll(async () => {
    // Scenario 2 runs under a non-UTC runtime (Node re-reads TZ when it is assigned).
    process.env.TZ = 'Pacific/Auckland';
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    basePrisma = app.get(PrismaService);
    tenant = await createTestTenant(basePrisma, 'veh-cursor');
    prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    bearer = `Bearer ${createTestAuthToken(app.get(AuthService), tenant, {
      auth_time: 1_700_000_000,
    })}`;
    const handshake = await request(app.getHttpServer())
      .post('/api/auth/scope-context')
      .set('Authorization', bearer)
      .expect(200);
    scopeContext = handshake.body.scopeContext as string;
  });

  beforeEach(async () => {
    await prisma.vehicle.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
  });

  afterAll(async () => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  async function seedVehicles(createdAts: Date[]) {
    await prisma.vehicle.createMany({
      data: createdAts.map((createdAt) => {
        const seq = ++vehicleSeq;
        return {
          tenant_id: tenant.tenantId,
          make: 'Skoda',
          model: `Octavia-${seq}`,
          year: 2022,
          createdAt,
        };
      }),
    });
  }

  function list(query: Record<string, string>, context = scopeContext) {
    return scopedListRequest(app, VEHICLES, bearer, context).query({
      pagination: 'cursor',
      ...query,
    });
  }

  function count(context = scopeContext) {
    return scopedListRequest(app, COUNT, bearer, context);
  }

  describe('vehicle custom filters', () => {
    beforeAll(async () => {
      await basePrisma.tenant.update({
        where: { id: tenant.tenantId },
        data: { custom_fields_enabled: true },
      });
      const fields = [
        { key: 'capacity', type: 'NUMBER' },
        { key: 'inspection', type: 'DATE' },
        { key: 'on_site', type: 'BOOLEAN' },
        { key: 'bay', type: 'TEXT' },
      ] as const;
      await prisma.customFieldDefinition.createMany({
        data: fields.map((field) => ({
          ...field,
          tenant_id: tenant.tenantId,
          entity: 'VEHICLE',
          label: field.key,
          purpose: 'Vehicle classification',
        })),
      });
    });

    beforeEach(async () => {
      await prisma.vehicle.createMany({
        data: [
          { capacity: 2, inspection: '2026-01-02', on_site: true, bay: 'A_1' },
          { capacity: 10, inspection: '2026-01-10', on_site: true, bay: 'AB1' },
          {
            capacity: 100,
            inspection: '2026-02-01',
            on_site: false,
            bay: 'A_2',
          },
        ].map((customFields) => ({
          tenant_id: tenant.tenantId,
          make: 'Skoda',
          model: String(customFields.capacity),
          year: 2022,
          createdAt: new Date(Date.UTC(2026, 0, customFields.capacity)),
          custom_fields: customFields,
        })),
      });
    });

    it.each<{ filter: Record<string, string>; model: string; matches: number }>(
      [
        {
          filter: { 'cf.capacity[gte]': '9', 'cf.capacity[lte]': '11' },
          model: '10',
          matches: 1,
        },
        {
          filter: {
            'cf.inspection[gte]': '2026-01-01',
            'cf.inspection[lte]': '2026-01-09',
          },
          model: '2',
          matches: 1,
        },
        { filter: { 'cf.on_site[is]': 'false' }, model: '100', matches: 1 },
        { filter: { 'cf.bay[contains]': 'A_' }, model: '100', matches: 2 },
        { filter: { 'cf.bay[eq]': 'AB1' }, model: '10', matches: 1 },
      ],
    )(
      'applies $filter before the vehicle page limit and in the count',
      async ({ filter, model, matches }) => {
        const page = await list({ ...filter, limit: '1' }).expect(200);
        const total = await count().query(filter).expect(200);
        expect([
          page.body.data.map((row: { model: string }) => row.model),
          total.body.count,
        ]).toEqual([[model], matches]);
      },
    );

    it('rejects offset mode with an active custom field filter fail-closed (400 CUSTOM_FIELD_FILTER_REQUIRES_CURSOR)', async () => {
      const response = await request(app.getHttpServer())
        .get(VEHICLES)
        .set('Authorization', bearer)
        .query({ page: '1', pageSize: '25', 'cf.bay': 'AB1' })
        .expect(400);
      expect(response.body.code).toBe('CUSTOM_FIELD_FILTER_REQUIRES_CURSOR');
    });

    it('ignores unknown custom keys in offset mode so the list loads', async () => {
      const response = await request(app.getHttpServer())
        .get(VEHICLES)
        .set('Authorization', bearer)
        .query({ page: '1', pageSize: '25', 'cf.unknown': 'x' })
        .expect(200);
      expect(response.body.data).toHaveLength(3);
    });

    it('ignores active custom filters in offset mode when the custom_fields flag is off', async () => {
      await basePrisma.tenant.update({
        where: { id: tenant.tenantId },
        data: { custom_fields_enabled: false },
      });
      try {
        const response = await request(app.getHttpServer())
          .get(VEHICLES)
          .set('Authorization', bearer)
          .query({ page: '1', pageSize: '25', 'cf.bay': 'AB1' })
          .expect(200);
        expect(response.body.data).toHaveLength(3);
      } finally {
        await basePrisma.tenant.update({
          where: { id: tenant.tenantId },
          data: { custom_fields_enabled: true },
        });
      }
    });

    it('sorts filtered vehicles by year in cursor mode across pages', async () => {
      await prisma.vehicle.updateMany({
        where: { tenant_id: tenant.tenantId, model: '2' },
        data: { year: 2024 },
      });
      await prisma.vehicle.updateMany({
        where: { tenant_id: tenant.tenantId, model: '100' },
        data: { year: 2019 },
      });
      const first = await list({
        'cf.bay[contains]': 'A_',
        sortField: 'year',
        sortDirection: 'asc',
        limit: '1',
      }).expect(200);
      const second = await list({
        'cf.bay[contains]': 'A_',
        sortField: 'year',
        sortDirection: 'asc',
        limit: '1',
        cursor: first.body.meta.nextCursor,
      }).expect(200);
      expect([
        first.body.data.map((r: { year: number }) => r.year),
        second.body.data.map((r: { year: number }) => r.year),
      ]).toEqual([[2019], [2024]]);
    });
  });

  // Regression: a local-time or second-precision cursor value skips or repeats rows that share a createdAt.
  it('customerVehicles_static_timestamp_roundtrip', async () => {
    const tiedLate = new Date('2026-03-29T00:30:00.120Z');
    const tiedEarly = new Date('2026-03-28T23:59:59.999Z');
    await seedVehicles([
      tiedLate,
      tiedLate,
      tiedLate,
      tiedEarly,
      tiedEarly,
      new Date('2026-01-01T00:00:00.001Z'),
      new Date('2026-06-01T12:00:00.000Z'),
    ]);
    const stored = await prisma.vehicle.findMany({
      where: { tenant_id: tenant.tenantId },
      select: { id: true, createdAt: true },
    });
    const byTuple = (direction: 1 | -1) =>
      [...stored]
        .sort(
          (a, b) =>
            direction * (a.createdAt.getTime() - b.createdAt.getTime()) ||
            direction * (a.id < b.id ? -1 : 1),
        )
        .map((row) => row.id);
    const createdAtById = new Map(
      stored.map((row) => [row.id, row.createdAt.toISOString()]),
    );

    for (const [sortDirection, expected] of [
      ['desc', byTuple(-1)],
      ['asc', byTuple(1)],
    ] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({
          sortField: 'createdAt',
          sortDirection,
          limit: '2',
          ...(cursor ? { cursor } : {}),
        }).expect(200);
        const ids = (page.body.data as { id: string }[]).map((row) => row.id);
        seen.push(...ids);
        cursor = page.body.meta.nextCursor ?? undefined;
        if (cursor) {
          const decoded = decodeListCursor(cursor);
          expect(decoded?.id).toBe(ids.at(-1));
          expect(decoded?.sv).toBe(createdAtById.get(ids.at(-1)!));
        }
      } while (cursor);
      expect(seen).toEqual(expected);
    }
  });

  // Regression: an uncapped or off-by-one probe reports 1000 as capped or 1001 as exact.
  it('customerVehicles_exact_count_boundary', async () => {
    const base = Date.UTC(2026, 0, 1);
    await seedVehicles(
      Array.from({ length: 1000 }, (_, index) => new Date(base + index)),
    );
    const exact = await count().expect(200);
    expect(exact.body).toMatchObject({ count: 1000, isCapped: false });

    await seedVehicles([new Date(base + 5000)]);
    const capped = await count().expect(200);
    expect(capped.body).toMatchObject({ count: 1000, isCapped: true });
  });

  // Regression: the new count route or cursor mode bypassing `vehicle.read`.
  it('403 list and count', async () => {
    const techBearer = await createMemberBearer(
      basePrisma,
      app.get(AuthService),
      tenant,
      'TECH',
    );
    await request(app.getHttpServer())
      .get(VEHICLES)
      .query({ pagination: 'cursor' })
      .set('Authorization', techBearer)
      .set(SCOPE_CONTEXT_HEADER, scopeContext)
      .expect(403);
    await request(app.getHttpServer())
      .get(COUNT)
      .set('Authorization', techBearer)
      .set(SCOPE_CONTEXT_HEADER, scopeContext)
      .expect(403);
  });

  // Regression: offset params silently mixed into a cursor chain.
  it('forbidden page param', async () => {
    const queries: Record<string, string>[] = [
      { page: '2' },
      { pageSize: '10' },
    ];
    for (const query of queries) {
      const response = await list(query).expect(400);
      expect(response.body.code).toBe('LIST_CURSOR_PARAM_FORBIDDEN');
    }
  });

  // Regression: cursor list or count served without, or with a stale, Scope Context (ADR-0038 §7).
  it('requires a matching scope context on list and count, offset mode unchanged', async () => {
    for (const call of [() => list({}, ''), () => count('')]) {
      const response = await call().expect(428);
      expect(response.body.code).toBe('CONTEXT_REQUIRED');
    }
    const [payload, signature] = scopeContext.split('.');
    const tampered = `${payload}.${signature.slice(1)}x`;
    for (const call of [() => list({}, tampered), () => count(tampered)]) {
      const response = await call().expect(412);
      expect(response.body.code).toBe('CONTEXT_MISMATCH');
    }
    const offset = await request(app.getHttpServer())
      .get(VEHICLES)
      .query({ page: '1', pageSize: '25' })
      .set('Authorization', bearer)
      .expect(200);
    expect(offset.body.meta).toMatchObject({ page: 1, pageSize: 25 });
  });
});
