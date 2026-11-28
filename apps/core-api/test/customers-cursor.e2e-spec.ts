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

const CUSTOMERS = '/api/customers';
const COUNT = '/api/customers/capped-count';

describe('Customers cursor list (AUT-957 e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenant: TestTenantResult;
  let bearer: string;
  let scopeContext: string;
  let customerSeq = 0;
  const originalTz = process.env.TZ;

  beforeAll(async () => {
    // Scenario 1 runs under a non-UTC runtime (Node re-reads TZ when it is assigned).
    process.env.TZ = 'Pacific/Auckland';
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    basePrisma = app.get(PrismaService);
    tenant = await createTestTenant(basePrisma, 'cust-cursor');
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
    await prisma.customer.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
  });

  afterAll(async () => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  async function seedCustomers(createdAts: Date[]) {
    await prisma.customer.createMany({
      data: createdAts.map((createdAt) => {
        const seq = ++customerSeq;
        return {
          tenant_id: tenant.tenantId,
          type: 'PRIVATE' as const,
          first_name: `First${seq}`,
          last_name: `Last${seq}`,
          createdAt,
        };
      }),
    });
  }

  function list(query: Record<string, string>, context = scopeContext) {
    return scopedListRequest(app, CUSTOMERS, bearer, context).query({
      pagination: 'cursor',
      ...query,
    });
  }

  function count(context = scopeContext) {
    return scopedListRequest(app, COUNT, bearer, context);
  }

  describe('custom field filters', () => {
    const segment = {
      entity: 'CUSTOMER' as const,
      key: 'segment',
      label: 'Segment',
      type: 'SELECT' as const,
      options: ['Fleet, regional', 'Retail', 'Trade'],
      purpose: 'Customer grouping',
    };

    beforeAll(async () => {
      await prisma.customFieldDefinition.createMany({
        data: [
          { ...segment, tenant_id: tenant.tenantId },
          {
            tenant_id: tenant.tenantId,
            entity: 'CUSTOMER',
            key: 'deleted',
            label: 'Archived',
            type: 'TEXT',
            purpose: 'Archived grouping',
            archived: true,
          },
        ],
      });
    });

    beforeEach(async () => {
      await basePrisma.tenant.update({
        where: { id: tenant.tenantId },
        data: { custom_fields_enabled: true },
      });
      await prisma.customer.createMany({
        data: ['Fleet, regional', 'Retail', 'Fleet, regional', 'Trade'].map(
          (value, index) => ({
            tenant_id: tenant.tenantId,
            type: 'PRIVATE',
            first_name: `Segment ${index}`,
            last_name: 'Customer',
            createdAt: new Date(Date.UTC(2026, 0, index + 1)),
            custom_fields: { segment: value, deleted: 'old' },
          }),
        ),
      });
    });

    afterAll(async () => {
      await prisma.customFieldDefinition.deleteMany({
        where: {
          tenant_id: tenant.tenantId,
          key: { in: [segment.key, 'deleted'] },
        },
      });
    });

    function names(response: { body: { data: { first_name: string }[] } }) {
      return response.body.data.map((row) => row.first_name);
    }

    it('returns only customers in the selected options, including options containing commas', async () => {
      const page = await list({})
        .query('cf.segment%5Bin%5D=Fleet%2C+regional&cf.segment%5Bin%5D=Trade')
        .expect(200);
      expect(names(page)).toEqual(['Segment 3', 'Segment 2', 'Segment 0']);
    });

    it('counts the filtered set, pages without gaps and rejects a cursor from another filter', async () => {
      const filter = { 'cf.segment': 'Fleet, regional' };
      const first = await list({ ...filter, limit: '1' }).expect(200);
      const cursor = first.body.meta.nextCursor;
      const second = await list({ ...filter, limit: '1', cursor }).expect(200);
      const total = await count().query(filter).expect(200);
      const mismatch = await list({ 'cf.segment': 'Retail', cursor }).expect(
        400,
      );
      expect([
        names(first),
        names(second),
        total.body,
        mismatch.body.code,
      ]).toEqual([
        ['Segment 2'],
        ['Segment 0'],
        expect.objectContaining({ count: 2, isCapped: false }),
        'LIST_CURSOR_INVALID',
      ]);
    });

    it('ignores archived and unknown custom keys in a bookmarked URL', async () => {
      const page = await list({ 'cf.deleted': 'x', 'cf.unknown': 'x' }).expect(
        200,
      );
      expect(names(page)).toEqual([
        'Segment 3',
        'Segment 2',
        'Segment 1',
        'Segment 0',
      ]);
    });

    it('ignores active custom filters and omits values when the flag is off', async () => {
      await basePrisma.tenant.update({
        where: { id: tenant.tenantId },
        data: { custom_fields_enabled: false },
      });
      const page = await list({ 'cf.segment[unsupported]': 'x' }).expect(200);
      expect(
        page.body.data.map(
          (row: { first_name: string; custom_fields?: unknown }) => [
            row.first_name,
            row.custom_fields,
          ],
        ),
      ).toEqual([
        ['Segment 3', undefined],
        ['Segment 2', undefined],
        ['Segment 1', undefined],
        ['Segment 0', undefined],
      ]);
    });

    it('rejects an unsupported operator for an active key', async () => {
      const response = await list({ 'cf.segment[contains]': 'Fleet' }).expect(
        422,
      );
      expect(response.body.code).toBe('CUSTOM_FIELD_FILTER_INVALID');
    });

    it('returns only own-tenant matches when another tenant uses the same custom key and value', async () => {
      const other = await createTestTenant(basePrisma, 'cust-cursor-other');
      const otherPrisma = createTenantAwarePrisma(basePrisma, other.tenantId);
      try {
        await basePrisma.tenant.update({
          where: { id: other.tenantId },
          data: { custom_fields_enabled: true },
        });
        await otherPrisma.customFieldDefinition.create({
          data: { ...segment, tenant_id: other.tenantId },
        });
        await otherPrisma.customer.create({
          data: {
            tenant_id: other.tenantId,
            type: 'PRIVATE',
            first_name: 'Other tenant',
            last_name: 'Customer',
            custom_fields: { segment: 'Fleet, regional' },
          },
        });
        const page = await list({ 'cf.segment': 'Fleet, regional' }).expect(
          200,
        );
        expect(names(page)).toEqual(['Segment 2', 'Segment 0']);
      } finally {
        await otherPrisma.customFieldDefinition.deleteMany({
          where: { tenant_id: other.tenantId, key: segment.key },
        });
        await cleanupTestTenantGraph(otherPrisma, other.tenantId);
      }
    });

    it('rejects offset mode with an active custom field filter fail-closed (400 CUSTOM_FIELD_FILTER_REQUIRES_CURSOR)', async () => {
      const response = await request(app.getHttpServer())
        .get(CUSTOMERS)
        .set('Authorization', bearer)
        .query({ page: '1', pageSize: '25', 'cf.segment': 'Retail' })
        .expect(400);
      expect(response.body.code).toBe('CUSTOM_FIELD_FILTER_REQUIRES_CURSOR');
    });

    it('ignores archived and unknown custom keys in offset mode so the list loads', async () => {
      const response = await request(app.getHttpServer())
        .get(CUSTOMERS)
        .set('Authorization', bearer)
        .query({ page: '1', pageSize: '25', 'cf.deleted': 'x', 'cf.unknown': 'x' })
        .expect(200);
      expect(response.body.data).toHaveLength(4);
    });

    it('ignores active custom filters in offset mode when the custom_fields flag is off', async () => {
      await basePrisma.tenant.update({
        where: { id: tenant.tenantId },
        data: { custom_fields_enabled: false },
      });
      const response = await request(app.getHttpServer())
        .get(CUSTOMERS)
        .set('Authorization', bearer)
        .query({ page: '1', pageSize: '25', 'cf.segment': 'Retail' })
        .expect(200);
      expect(response.body.data).toHaveLength(4);
    });

    it('sorts filtered customers by company_name in cursor mode across pages', async () => {
      await prisma.customer.updateMany({
        where: { tenant_id: tenant.tenantId, first_name: 'Segment 0' },
        data: { company_name: 'Zebra GmbH' },
      });
      await prisma.customer.updateMany({
        where: { tenant_id: tenant.tenantId, first_name: 'Segment 2' },
        data: { company_name: 'Alpha GmbH' },
      });
      const first = await list({
        'cf.segment': 'Fleet, regional',
        sortField: 'company_name',
        sortDirection: 'asc',
        limit: '1',
      }).expect(200);
      const second = await list({
        'cf.segment': 'Fleet, regional',
        sortField: 'company_name',
        sortDirection: 'asc',
        limit: '1',
        cursor: first.body.meta.nextCursor,
      }).expect(200);
      expect([
        first.body.data.map((r: { company_name: string | null }) => r.company_name),
        second.body.data.map((r: { company_name: string | null }) => r.company_name),
      ]).toEqual([['Alpha GmbH'], ['Zebra GmbH']]);
    });
  });

  // Regression: a local-time or second-precision cursor value skips or repeats rows that share a createdAt.
  it('customers_static_timestamp_roundtrip', async () => {
    const tiedLate = new Date('2026-03-29T00:30:00.120Z');
    const tiedEarly = new Date('2026-03-28T23:59:59.999Z');
    await seedCustomers([
      tiedLate,
      tiedLate,
      tiedLate,
      tiedEarly,
      tiedEarly,
      new Date('2026-01-01T00:00:00.001Z'),
      new Date('2026-06-01T12:00:00.000Z'),
    ]);
    const stored = await prisma.customer.findMany({
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
  it('customers_exact_count_boundary', async () => {
    const base = Date.UTC(2026, 0, 1);
    await seedCustomers(
      Array.from({ length: 1000 }, (_, index) => new Date(base + index)),
    );
    const exact = await count().expect(200);
    expect(exact.body).toMatchObject({ count: 1000, isCapped: false });

    await seedCustomers([new Date(base + 5000)]);
    const capped = await count().expect(200);
    expect(capped.body).toMatchObject({ count: 1000, isCapped: true });
  });

  // Regression: the new count route or cursor mode bypassing `customer.read`.
  it('403 list and count', async () => {
    const techBearer = await createMemberBearer(
      basePrisma,
      app.get(AuthService),
      tenant,
      'TECH',
    );
    await request(app.getHttpServer())
      .get(CUSTOMERS)
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
      .get(CUSTOMERS)
      .query({ page: '1', pageSize: '25' })
      .set('Authorization', bearer)
      .expect(200);
    expect(offset.body.meta).toMatchObject({ page: 1, pageSize: 25 });
  });
});
