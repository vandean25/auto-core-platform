import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { SCOPE_CONTEXT_HEADER } from '../src/auth/scope-context/scope-context.constants.js';
import { decodeListCursor } from '../src/common/list-cursor/list-cursor.codec.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createMemberBearer,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const ORDERS = '/api/workshop/orders';
const COUNT = '/api/workshop/orders/capped-count';

describe('Workshop orders cursor list (AUT-956 e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenant: TestTenantResult;
  let siteId: string;
  let vehicleId: string;
  let bearer: string;
  let scopeContext: string;
  let orderSeq = 0;
  const originalTz = process.env.TZ;

  beforeAll(async () => {
    // Scenario 1 runs under a non-UTC runtime (Node re-reads TZ when it is assigned).
    process.env.TZ = 'Pacific/Auckland';
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    basePrisma = app.get(PrismaService);
    tenant = await createTestTenant(basePrisma, 'wo-cursor');
    prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    bearer = `Bearer ${createTestAuthToken(app.get(AuthService), tenant, {
      auth_time: 1_700_000_000,
    })}`;
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        make: 'Skoda',
        model: 'Octavia',
        year: 2021,
        vin: 'WOCURSORE2E000001',
      },
    });
    vehicleId = vehicle.id;
    const handshake = await request(app.getHttpServer())
      .post('/api/auth/scope-context')
      .set('Authorization', bearer)
      .expect(200);
    scopeContext = handshake.body.scopeContext as string;
  });

  beforeEach(async () => {
    await prisma.workshopOrder.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
  });

  afterAll(async () => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  async function seedOrders(createdAts: Date[]) {
    await prisma.workshopOrder.createMany({
      data: createdAts.map((createdAt) => ({
        tenant_id: tenant.tenantId,
        site_id: siteId,
        order_number: `WO-CUR-${++orderSeq}`,
        vehicle_id: vehicleId,
        odometer: 1000,
        fuel_level: 50,
        createdAt,
      })),
    });
  }

  function list(query: Record<string, string>, context = scopeContext) {
    return request(app.getHttpServer())
      .get(ORDERS)
      .query({ pagination: 'cursor', ...query })
      .set('Authorization', bearer)
      .set(SCOPE_CONTEXT_HEADER, context);
  }

  function count(context = scopeContext) {
    return request(app.getHttpServer())
      .get(COUNT)
      .set('Authorization', bearer)
      .set(SCOPE_CONTEXT_HEADER, context);
  }

  // Regression: a local-time or second-precision cursor value skips or repeats rows that share a createdAt.
  it('workshopOrders_static_timestamp_roundtrip', async () => {
    const tiedLate = new Date('2026-03-29T00:30:00.120Z');
    const tiedEarly = new Date('2026-03-28T23:59:59.999Z');
    await seedOrders([
      tiedLate,
      tiedLate,
      tiedLate,
      tiedEarly,
      tiedEarly,
      new Date('2026-01-01T00:00:00.001Z'),
      new Date('2026-06-01T12:00:00.000Z'),
    ]);
    const stored = await prisma.workshopOrder.findMany({
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
  it('workshopOrders_exact_count_boundary', async () => {
    const base = Date.UTC(2026, 0, 1);
    await seedOrders(
      Array.from({ length: 1000 }, (_, index) => new Date(base + index)),
    );
    const exact = await count().expect(200);
    expect(exact.body).toMatchObject({ count: 1000, isCapped: false });

    await seedOrders([new Date(base + 5000)]);
    const capped = await count().expect(200);
    expect(capped.body).toMatchObject({ count: 1000, isCapped: true });
  });

  // Regression: the new count route or cursor mode bypassing `workshop.order.read`.
  it('403 list and count', async () => {
    const techBearer = await createMemberBearer(
      basePrisma,
      app.get(AuthService),
      tenant,
      'TECH',
    );
    await request(app.getHttpServer())
      .get(ORDERS)
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
    const response = await list({ page: '2' }).expect(400);
    expect(response.body.code).toBe('LIST_CURSOR_PARAM_FORBIDDEN');
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
      .get(ORDERS)
      .set('Authorization', bearer)
      .expect(200);
    expect(offset.body.meta).toMatchObject({ page: 1, pageSize: 25 });
  });
});
