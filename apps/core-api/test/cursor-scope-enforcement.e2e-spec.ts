import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { SCOPE_CONTEXT_HEADER } from '../src/auth/scope-context/scope-context.constants.js';
import { hashListFilterContext } from '../src/common/list-cursor/list-cursor.filter-hash.js';
import { DashboardRealtimeService } from '../src/dashboard-realtime/dashboard-realtime.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import { stubFirebaseAdminAuthForCustomClaimsE2e } from './helpers/firebase-auth-e2e-mocks.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { cleanupE2eTenantGraph, teardownTestApp } from './test-lifecycle.js';

const lists = [
  { path: '/api/sales/invoices', filters: {} },
  { path: '/api/inventory', filters: {} },
  { path: '/api/vehicle-stock', filters: { stock_status: 'IN_STOCK' } },
] as const;
const endpoints = lists.flatMap(({ path, filters }) => [
  { path, query: { ...filters, pagination: 'cursor' } },
  { path: `${path}/capped-count`, query: filters },
]);

describe('Cursor scope enforcement (AUT-941)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenantResult;
  let owner: string;

  beforeAll(async () => {
    stubFirebaseAdminAuthForCustomClaimsE2e();
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    prisma = app.get(PrismaService);
    tenant = await createTestTenant(prisma, 'cursor-scope');
    owner = `Bearer ${createTestAuthToken(app.get(AuthService), tenant, {
      auth_time: 1_700_000_000,
    })}`;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (tenant) await cleanupE2eTenantGraph(prisma, tenant.tenantId);
    if (app) await teardownTestApp(app, prisma);
  });

  async function handshake(bearer: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/auth/scope-context')
      .set('Authorization', bearer)
      .expect(200);
    return response.body.scopeContext as string;
  }

  function getEndpoint(
    endpoint: { path: string; query: object },
    bearer: string,
    context?: string,
  ) {
    const call = request(app.getHttpServer())
      .get(endpoint.path)
      .query(endpoint.query)
      .set('Authorization', bearer);
    return context === undefined
      ? call
      : call.set(SCOPE_CONTEXT_HEADER, context);
  }

  async function createMember(role: 'SALES' | 'TECH') {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    const firebaseUid = `cursor-scope-${role}-${tenant.tenantId}`;
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
        role,
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
    const token = createTestAuthToken(app.get(AuthService), tenant, {
      sub: firebaseUid,
      email: user.email,
      role,
      auth_time: 1_700_000_000,
    });
    return { id: member.id, bearer: `Bearer ${token}` };
  }

  it('required on page and count', async () => {
    for (const endpoint of endpoints) {
      const response = await getEndpoint(endpoint, owner).expect(428);
      expect(response.body.code).toBe('CONTEXT_REQUIRED');
    }
  });

  it('missed event epoch replay', async () => {
    const { id, bearer } = await createMember('SALES');
    const previous = await handshake(bearer);
    jest
      .spyOn(app.get(DashboardRealtimeService), 'emitClaimsUpdated')
      .mockImplementation(() => undefined);
    for (const role of ['ADMIN', 'SALES']) {
      await request(app.getHttpServer())
        .patch(`/api/tenant-members/${id}`)
        .set('Authorization', owner)
        .send({ role })
        .expect(200);
    }
    for (const endpoint of endpoints) {
      const response = await getEndpoint(endpoint, bearer, previous).expect(
        412,
      );
      expect(response.body.code).toBe('CONTEXT_MISMATCH');
    }
  });

  it('403 precedence', async () => {
    const { bearer } = await createMember('TECH');
    const valid = await handshake(bearer);
    const otherSession = await handshake(owner);
    for (const endpoint of endpoints) {
      for (const context of [
        undefined,
        'invalid-context',
        otherSession,
        valid,
      ]) {
        await getEndpoint(endpoint, bearer, context).expect(403);
      }
    }
  });

  it('v1 cursor invalid', async () => {
    const context = await handshake(owner);
    const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    const legacyCursors = [
      {
        ep: 'invoices',
        sort: 'invoice_number',
        sv: 'RE-001',
        filters: { search: '' },
      },
      {
        ep: 'inventory',
        sort: 'sku',
        sv: 'SKU-001',
        filters: { search: '', location: '', brand: '', brandId: null },
      },
      {
        ep: 'vehicle-stock',
        sort: 'make',
        sv: 'Skoda',
        filters: { search: '', stock_status: 'IN_STOCK' },
      },
    ];
    for (const [index, { path, filters }] of lists.entries()) {
      const { ep, sort, sv, filters: cursorFilters } = legacyCursors[index];
      const cursor = Buffer.from(
        JSON.stringify({
          v: 1,
          ep,
          sort,
          dir: 'asc',
          sv,
          fh: hashListFilterContext(cursorFilters),
          tid: tenant.tenantId,
          sid: siteId,
          id: '33333333-3333-4333-8333-333333333333',
        }),
      ).toString('base64url');
      const response = await getEndpoint(
        {
          path,
          query: { ...filters, cursor, sortField: sort, sortDirection: 'asc' },
        },
        owner,
        context,
      ).expect(400);
      expect(response.body.code).toBe('LIST_CURSOR_INVALID');
    }
  });

  it('offset unaffected', async () => {
    for (const { path, filters } of lists) {
      const response = await getEndpoint(
        { path, query: filters },
        owner,
      ).expect(200);
      if (path === '/api/sales/invoices') {
        expect(response.body).toEqual([]);
      } else {
        expect(response.body).toMatchObject({
          data: [],
          meta: { total: 0, page: 1 },
        });
      }
    }
  });

  it('a tenant-only session can read invoices while site lists still require an active site', async () => {
    const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    const where = { firebaseUid: tenant.firebaseUid };
    await prisma.user.update({ where, data: { active_site_id: null } });
    try {
      await getEndpoint({ path: lists[0].path, query: {} }, owner).expect(200);
      for (const endpoint of endpoints.filter(
        ({ path }) => !path.startsWith(lists[0].path),
      )) {
        for (const context of [undefined, 'invalid-context']) {
          const response = await getEndpoint(endpoint, owner, context).expect(
            422,
          );
          expect(response.body.code).toBe('ACTIVE_SITE_REQUIRED');
        }
      }
      await getEndpoint(endpoints[0], owner).expect(428);
      const context = await handshake(owner);
      await getEndpoint(endpoints[0], owner, context).expect(200);
      await getEndpoint(endpoints[1], owner, context).expect(200);
    } finally {
      await prisma.user.update({ where, data: { active_site_id: siteId } });
    }
  });

  it('ended session takes precedence over missing, invalid and valid scope headers', async () => {
    const bearer = `Bearer ${createTestAuthToken(app.get(AuthService), tenant, {
      auth_time: 1_700_000_001,
    })}`;
    const valid = await handshake(bearer);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', bearer)
      .expect(204);
    for (const endpoint of endpoints) {
      for (const context of [undefined, 'invalid-context', valid]) {
        await getEndpoint(endpoint, bearer, context).expect(401);
      }
    }
  });
});
