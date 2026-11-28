import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { SCOPE_CONTEXT_HEADER } from '../src/auth/scope-context/scope-context.constants.js';
import { decodeListCursor } from '../src/common/list-cursor/list-cursor.codec.js';
import { DashboardRealtimeService } from '../src/dashboard-realtime/dashboard-realtime.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import { stubFirebaseAdminAuthForCustomClaimsE2e } from './helpers/firebase-auth-e2e-mocks.js';
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

const ORDERS = '/api/sales-orders';
const COUNT = '/api/sales-orders/capped-count';

describe('Sales orders cursor list (AUT-943 e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenant: TestTenantResult;
  let siteId: string;
  let otherSiteId: string;
  let customerId: string;
  let otherCustomerId: string;
  let bearer: string;
  let scopeContext: string;
  let scopeContextDigest: string;
  let orderSeq = 0;
  const originalTz = process.env.TZ;

  beforeAll(async () => {
    // Scenario 1 runs under a non-UTC runtime (Node re-reads TZ when it is assigned).
    process.env.TZ = 'Pacific/Auckland';
    stubFirebaseAdminAuthForCustomClaimsE2e();
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    basePrisma = app.get(PrismaService);
    tenant = await createTestTenant(basePrisma, 'so-cursor');
    prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    const mainSite = await prisma.site.findFirstOrThrow({
      where: { id: siteId, tenant_id: tenant.tenantId },
      select: { legal_entity_id: true },
    });

    const secondSite = await prisma.site.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: mainSite.legal_entity_id,
        code: 'BRANCH-2',
        name: 'Branch 2',
        is_active: true,
      },
    });
    otherSiteId = secondSite.id;

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenant.tenantId,
        first_name: 'Erika',
        last_name: 'Meier',
        email: 'erika.meier@example.com',
        phone: '+43123456',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const otherCustomer = await prisma.customer.create({
      data: {
        tenant_id: tenant.tenantId,
        first_name: 'Contact',
        last_name: 'Alpine',
        company_name: 'Alpine Motors GmbH',
        email: 'office@alpine.example.com',
        phone: '+43654321',
        type: 'COMPANY',
      },
    });
    otherCustomerId = otherCustomer.id;

    bearer = `Bearer ${createTestAuthToken(app.get(AuthService), tenant, {
      auth_time: 1_700_000_000,
    })}`;
    const handshake = await request(app.getHttpServer())
      .post('/api/auth/scope-context')
      .set('Authorization', bearer)
      .expect(200);
    scopeContext = handshake.body.scopeContext as string;
    scopeContextDigest = handshake.body.scopeContextDigest as string;
  });

  beforeEach(async () => {
    await prisma.salesOrder.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  async function seedOrders(
    rows: Array<{
      createdAt?: Date;
      order_number?: string;
      status?: SalesOrderStatus;
      site_id?: string | null;
      customer_id?: string;
    }>,
  ) {
    await prisma.salesOrder.createMany({
      data: rows.map((row) => ({
        tenant_id: tenant.tenantId,
        site_id: row.site_id === undefined ? siteId : row.site_id,
        order_number: row.order_number ?? `SO-CUR-${++orderSeq}`,
        customer_id: row.customer_id ?? customerId,
        status: row.status ?? SalesOrderStatus.DRAFT,
        total_amount: 100,
        ...(row.createdAt ? { createdAt: row.createdAt } : {}),
      })),
    });
  }

  function list(query: Record<string, string>, context: string | null = scopeContext) {
    const req = request(app.getHttpServer())
      .get(ORDERS)
      .query({ pagination: 'cursor', ...query })
      .set('Authorization', bearer);
    return context === null ? req : req.set(SCOPE_CONTEXT_HEADER, context);
  }

  function count(query: Record<string, string> = {}, context: string | null = scopeContext) {
    const req = request(app.getHttpServer())
      .get(COUNT)
      .query(query)
      .set('Authorization', bearer);
    return context === null ? req : req.set(SCOPE_CONTEXT_HEADER, context);
  }

  // Regression: a local-time or second-precision cursor value skips or repeats rows that share a createdAt.
  it('salesOrders_static_timestamp_roundtrip', async () => {
    const tiedLate = new Date('2026-03-29T00:30:00.120Z');
    const tiedEarly = new Date('2026-03-28T23:59:59.999Z');
    await seedOrders([
      { createdAt: tiedLate, order_number: 'SO-2026-10000' },
      { createdAt: tiedLate, order_number: 'SO-2026-1001' },
      { createdAt: tiedLate, order_number: 'SO-2026-9999' },
      { createdAt: tiedEarly, order_number: 'SO-2026-2000' },
      { createdAt: tiedEarly, order_number: 'SO-2026-2001' },
      { createdAt: new Date('2026-01-01T00:00:00.001Z'), order_number: 'SO-2026-0001' },
      { createdAt: new Date('2026-06-01T12:00:00.000Z'), order_number: 'SO-2026-3000' },
    ]);
    const stored = await prisma.salesOrder.findMany({
      where: { tenant_id: tenant.tenantId },
      select: { id: true, createdAt: true, order_number: true },
    });
    const byCreatedAtTuple = (direction: 1 | -1) =>
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

    // Default (no sortField/sortDirection) -> createdAt DESC, id DESC
    const defaultPage = await list({ limit: '2' }).expect(200);
    expect(defaultPage.body.meta).toMatchObject({
      hasNextPage: true,
      limit: 2,
      scopeContextDigest,
    });
    expect((defaultPage.body.data as { id: string }[]).map((r) => r.id)).toEqual(
      byCreatedAtTuple(-1).slice(0, 2),
    );

    for (const [sortDirection, expected] of [
      ['desc', byCreatedAtTuple(-1)],
      ['asc', byCreatedAtTuple(1)],
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

    // order_number ASC and DESC (database text order)
    const byOrderNumber = (direction: 1 | -1) =>
      [...stored]
        .sort(
          (a, b) =>
            direction * (a.order_number < b.order_number ? -1 : a.order_number > b.order_number ? 1 : 0) ||
            direction * (a.id < b.id ? -1 : 1),
        )
        .map((row) => row.id);

    for (const [sortDirection, expected] of [
      ['asc', byOrderNumber(1)],
      ['desc', byOrderNumber(-1)],
    ] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({
          sortField: 'order_number',
          sortDirection,
          limit: '3',
          ...(cursor ? { cursor } : {}),
        }).expect(200);
        const ids = (page.body.data as { id: string }[]).map((row) => row.id);
        seen.push(...ids);
        cursor = page.body.meta.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual(expected);
    }
  });

  // Regression: an uncapped or off-by-one probe reports 1000 as capped or 1001 as exact.
  it('salesOrders_exact_count_boundary', async () => {
    const base = Date.UTC(2026, 0, 1);
    await seedOrders(
      Array.from({ length: 1000 }, (_, index) => ({
        createdAt: new Date(base + index),
      })),
    );
    const exact = await count().expect(200);
    expect(exact.body).toMatchObject({
      count: 1000,
      isCapped: false,
      scopeContextDigest,
    });

    await seedOrders([{ createdAt: new Date(base + 5000) }]);
    const capped = await count().expect(200);
    expect(capped.body).toMatchObject({
      count: 1000,
      isCapped: true,
      scopeContextDigest,
    });
  });

  // Regression: A->B->A role change with websocket delivery suppressed must still invalidate old scope context.
  it('salesOrders_missed_event_epoch_replay', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const firebaseUid = `so-epoch-${tenant.tenantId}`;
    const user = await tenantPrisma.user.create({
      data: {
        firebaseUid,
        email: `${firebaseUid}@example.com`,
        active_site_id: siteId,
        active_tenant_id: tenant.tenantId,
      },
    });
    const member = await tenantPrisma.tenantMember.create({
      data: {
        tenant_id: tenant.tenantId,
        user_id: user.id,
        role: 'SALES',
        is_active: true,
      },
    });
    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenant.tenantId,
        user_id: user.id,
        site_id: siteId,
        is_active: true,
      },
    });
    const memberBearer = `Bearer ${createTestAuthToken(app.get(AuthService), tenant, {
      sub: firebaseUid,
      email: user.email,
      role: 'SALES',
      auth_time: 1_700_000_000,
    })}`;
    const previous = (
      await request(app.getHttpServer())
        .post('/api/auth/scope-context')
        .set('Authorization', memberBearer)
        .expect(200)
    ).body.scopeContext as string;

    jest
      .spyOn(app.get(DashboardRealtimeService), 'emitClaimsUpdated')
      .mockImplementation(() => undefined);

    for (const role of ['ADMIN', 'SALES']) {
      await request(app.getHttpServer())
        .patch(`/api/tenant-members/${member.id}`)
        .set('Authorization', bearer)
        .send({ role })
        .expect(200);
    }

    for (const call of [
      () =>
        request(app.getHttpServer())
          .get(ORDERS)
          .query({ pagination: 'cursor' })
          .set('Authorization', memberBearer)
          .set(SCOPE_CONTEXT_HEADER, previous),
      () =>
        request(app.getHttpServer())
          .get(COUNT)
          .set('Authorization', memberBearer)
          .set(SCOPE_CONTEXT_HEADER, previous),
    ]) {
      const response = await call().expect(412);
      expect(response.body.code).toBe('CONTEXT_MISMATCH');
    }
  });

  // Regression: the new count route or cursor mode bypassing `sales.order.read`.
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
    const queries: Record<string, string>[] = [
      { page: '2' },
      { pageSize: '10' },
      { params: JSON.stringify({ page: 2 }) },
      { params: JSON.stringify({ pageSize: 10 }) },
    ];
    for (const query of queries) {
      const response = await list(query).expect(400);
      expect(response.body.code).toBe('LIST_CURSOR_PARAM_FORBIDDEN');
    }
  });

  // Regression: missing active site returned HTTP_422 instead of ACTIVE_SITE_REQUIRED or lost to 428.
  it('returns 422 ACTIVE_SITE_REQUIRED on list and count before scope-context checks', async () => {
    const user = await basePrisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
    });
    const previousSiteId = user.active_site_id;
    await basePrisma.user.update({
      where: { id: user.id },
      data: { active_site_id: null },
    });
    try {
      for (const call of [
        () => list({}),
        () => list({}, ''),
        () => count({}),
        () => count({}, ''),
      ]) {
        const response = await call().expect(422);
        expect(response.body.code).toBe('ACTIVE_SITE_REQUIRED');
      }
    } finally {
      await basePrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: previousSiteId },
      });
    }
  });

  // Regression: cursor list or count served without, or with a stale, Scope Context; context errors rank before 400s.
  it('requires matching scope context before parameter validation and leaves offset mode unchanged', async () => {
    for (const call of [
      () => list({}, null),
      () => list({ page: '2' }, null),
      () => count({}, null),
    ]) {
      const response = await call().expect(428);
      expect(response.body.code).toBe('CONTEXT_REQUIRED');
    }

    const [payload, signature] = scopeContext.split('.');
    const tampered = `${payload}.${signature.slice(1)}x`;
    for (const call of [() => list({}, tampered), () => count({}, tampered)]) {
      const response = await call().expect(412);
      expect(response.body.code).toBe('CONTEXT_MISMATCH');
    }

    // Legacy offset mode unchanged (no SC header required, old meta shape)
    await seedOrders([{ order_number: 'SO-LEGACY-1' }]);
    const offset = await request(app.getHttpServer())
      .get(ORDERS)
      .set('Authorization', bearer)
      .expect(200);
    expect(offset.body.meta).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    });
    expect(offset.body.meta.scopeContextDigest).toBeUndefined();
  });

  it('validates D5 params, status, and sort codes and scopes visibility to active site', async () => {
    await seedOrders([
      {
        order_number: 'SO-MATCH-1',
        status: SalesOrderStatus.CONFIRMED,
        customer_id: otherCustomerId,
        site_id: siteId,
      },
      {
        order_number: 'SO-OTHER-SITE',
        status: SalesOrderStatus.CONFIRMED,
        customer_id: otherCustomerId,
        site_id: otherSiteId,
      },
      {
        order_number: 'SO-NULL-SITE',
        status: SalesOrderStatus.CONFIRMED,
        customer_id: otherCustomerId,
        site_id: null,
      },
    ]);

    // Effective params / invalid status / unsupported sort
    const badParams = await list({
      params: JSON.stringify({ filters: [{ field: 'status', operator: 'equals', value: 'DRAFT' }] }),
    }).expect(400);
    expect(badParams.body.code).toBe('LIST_PARAMS_UNSUPPORTED');

    const badStatus = await list({ status: 'NOT_A_STATUS' }).expect(400);
    expect(badStatus.body.code).toBe('LIST_STATUS_INVALID');

    const badSort = await list({ sortField: 'total_amount' }).expect(400);
    expect(badSort.body.code).toBe('LIST_CURSOR_SORT_UNSUPPORTED');

    const dirOnly = await list({ sortDirection: 'asc' }).expect(400);
    expect(dirOnly.body.code).toBe('LIST_CURSOR_SORT_UNSUPPORTED');

    // Legacy status override of params.filters works in cursor mode
    const overridden = await list({
      status: 'CONFIRMED',
      search: 'Alpine',
      params: JSON.stringify({
        filters: [{ field: 'status', operator: 'equals', value: 'DRAFT' }],
      }),
    }).expect(200);
    expect(overridden.body.data).toHaveLength(1);
    expect(overridden.body.data[0].order_number).toBe('SO-MATCH-1');

    const countRes = await count({ status: 'CONFIRMED', search: 'Alpine' }).expect(200);
    expect(countRes.body).toMatchObject({
      count: 1,
      isCapped: false,
      scopeContextDigest,
    });
  });
});
