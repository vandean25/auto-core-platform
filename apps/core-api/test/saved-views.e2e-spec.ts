import { INestApplication } from '@nestjs/common';
import { TenantMemberRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import { stubFirebaseAdminAuthForCustomClaimsE2e } from './helpers/firebase-auth-e2e-mocks.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';

describe('Saved Views (AUT-938)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  const tenantIds: string[] = [];
  const userIds: string[] = [];

  async function createMember(
    tenantId: string,
    role: TenantMemberRole,
    prefix: string,
  ) {
    const uid = `${prefix}-${randomUUID()}`;
    const email = `${uid}@saved-views.test`;
    const { user, membership } = await runWithTenantContext(
      tenantId,
      async () => {
        const createdUser = await prisma.user.create({
          data: {
            firebaseUid: uid,
            email,
            firstName: prefix,
            lastName: 'Tester',
            active_tenant_id: tenantId,
          },
        });
        const createdMembership = await prisma.tenantMember.create({
          data: {
            tenant_id: tenantId,
            user_id: createdUser.id,
            role,
            is_active: true,
          },
        });
        return { user: createdUser, membership: createdMembership };
      },
    );
    userIds.push(user.id);

    const token = createTestAuthToken(authService, {
      tenantId,
      firebaseUid: uid,
      email,
      role,
    });

    return { user, membership, token };
  }

  beforeAll(async () => {
    stubFirebaseAdminAuthForCustomClaimsE2e();
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await cleanupTestTenantGraph(prisma, tenantId);
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
    await app.close();
  });

  // Scenario 1: WHEN an ADMIN creates a TENANT view on /sales/invoices THEN a SALES member sees it read-only and a TECH member does not see it
  it('TECH does not see a team view of /sales/invoices', async () => {
    const tenant = await createTestTenant(prisma, 'sv-s1');
    tenantIds.push(tenant.tenantId);

    const admin = await createMember(tenant.tenantId, 'ADMIN', 'sv-admin');
    const sales = await createMember(tenant.tenantId, 'SALES', 'sv-sales');
    const tech = await createMember(tenant.tenantId, 'TECH', 'sv-tech');

    const created = await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        listPath: '/sales/invoices',
        name: 'Offene Rechnungen',
        href: '/sales/invoices?filter_status=ISSUED',
        visibility: 'TENANT',
      })
      .expect(201);

    const salesList = await request(app.getHttpServer())
      .get('/api/saved-views?listPath=/sales/invoices')
      .set('Authorization', `Bearer ${sales.token}`)
      .expect(200);

    expect(
      (salesList.body.data as Array<{ id: string }>).map((v) => v.id),
    ).toContain(created.body.id);

    const techList = await request(app.getHttpServer())
      .get('/api/saved-views')
      .set('Authorization', `Bearer ${tech.token}`)
      .expect(200);

    expect(
      (techList.body.data as Array<{ id: string }>).map((v) => v.id),
    ).not.toContain(created.body.id);

    // SALES can copy the TENANT view into their own PERSONAL views.
    const copied = await request(app.getHttpServer())
      .post(`/api/saved-views/${created.body.id}/copy`)
      .set('Authorization', `Bearer ${sales.token}`)
      .send({ name: 'Meine Kopie' })
      .expect(201);

    expect(copied.body.visibility).toBe('PERSONAL');
    expect(copied.body.ownerUserId).toBe(sales.user.id);
  });

  // Scenario 2: WHEN a member of another tenant lists views THEN the shared view is not returned
  it('cross-tenant isolation', async () => {
    const tenantA = await createTestTenant(prisma, 'sv-iso-a');
    const tenantB = await createTestTenant(prisma, 'sv-iso-b');
    tenantIds.push(tenantA.tenantId, tenantB.tenantId);

    const tokenA = createTestAuthToken(authService, tenantA);
    const tokenB = createTestAuthToken(authService, tenantB);

    const created = await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        listPath: '/customers',
        name: 'Tenant A Team View',
        href: '/customers?search=Alpha',
        visibility: 'TENANT',
      })
      .expect(201);

    const listB = await request(app.getHttpServer())
      .get('/api/saved-views')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(
      (listB.body.data as Array<{ id: string }>).map((v) => v.id),
    ).not.toContain(created.body.id);
  });

  // Scenario 3: WHEN SALES tries to create or edit a TENANT view THEN 403
  it('share requires views.shared.manage', async () => {
    const tenant = await createTestTenant(prisma, 'sv-s3');
    tenantIds.push(tenant.tenantId);

    const admin = await createMember(tenant.tenantId, 'ADMIN', 'sv-s3-adm');
    const sales = await createMember(tenant.tenantId, 'SALES', 'sv-s3-sls');

    await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${sales.token}`)
      .send({
        listPath: '/customers',
        name: 'Forbidden Share',
        href: '/customers',
        visibility: 'TENANT',
      })
      .expect(403);

    const teamView = await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        listPath: '/customers',
        name: 'Admin Team View',
        href: '/customers',
        visibility: 'TENANT',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/saved-views/${teamView.body.id}`)
      .set('Authorization', `Bearer ${sales.token}`)
      .send({ name: 'Hijacked', version: teamView.body.version })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/saved-views/${teamView.body.id}?version=${teamView.body.version}`)
      .set('Authorization', `Bearer ${sales.token}`)
      .expect(403);
  });

  // Scenario 4: WHEN an href is absolute, javascript: or has a pathname other than list_path THEN 400 SAVED_VIEW_INVALID
  it.each([
    ['https://evil.example/customers', '/customers'],
    ['//evil.example/customers', '/customers'],
    ['javascript:alert(1)', '/customers'],
    ['/sales/invoices?search=x', '/customers'],
    ['/customers?evil=1', '/customers'],
  ])('href validation rejects %s', async (href, listPath) => {
    const tenant = await createTestTenant(prisma, 'sv-s4');
    tenantIds.push(tenant.tenantId);
    const token = createTestAuthToken(authService, tenant);

    const res = await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${token}`)
      .send({
        listPath,
        name: 'Bad View',
        href,
        visibility: 'PERSONAL',
      })
      .expect(400);

    expect(res.body.code).toBe('SAVED_VIEW_INVALID');
  });

  // Scenario 5: WHEN two concurrent creates would exceed 50 PERSONAL views for one list THEN exactly one fails with 422 SAVED_VIEW_LIMIT
  it('limit serialized', async () => {
    const tenant = await createTestTenant(prisma, 'sv-s5');
    tenantIds.push(tenant.tenantId);
    const member = await createMember(tenant.tenantId, 'ADMIN', 'sv-s5-user');

    // Seed 49 PERSONAL views directly for this user + list.
    await runWithTenantContext(tenant.tenantId, () =>
      prisma.savedView.createMany({
        data: Array.from({ length: 49 }, (_, i) => ({
          tenant_id: tenant.tenantId,
          owner_user_id: member.user.id,
          list_path: '/customers',
          name: `Seed View ${i + 1}`,
          href: `/customers?search=v${i + 1}`,
          visibility: 'PERSONAL',
        })),
      }),
    );

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/saved-views')
        .set('Authorization', `Bearer ${member.token}`)
        .send({
          listPath: '/customers',
          name: 'Concurrent 50a',
          href: '/customers?search=50a',
          visibility: 'PERSONAL',
        }),
      request(app.getHttpServer())
        .post('/api/saved-views')
        .set('Authorization', `Bearer ${member.token}`)
        .send({
          listPath: '/customers',
          name: 'Concurrent 50b',
          href: '/customers?search=50b',
          visibility: 'PERSONAL',
        }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 422]);
    const rejected = resA.status === 422 ? resA : resB;
    expect(rejected.body.code).toBe('SAVED_VIEW_LIMIT');
  });

  // Scenario 6: WHEN a member is removed from the tenant THEN their PERSONAL views are deleted and their TENANT views remain with no owner
  it('membership removal cleanup', async () => {
    const tenant = await createTestTenant(prisma, 'sv-s6');
    tenantIds.push(tenant.tenantId);

    const owner = await createMember(tenant.tenantId, 'OWNER', 'sv-s6-owner');
    const departingAdmin = await createMember(
      tenant.tenantId,
      'ADMIN',
      'sv-s6-leaving',
    );

    const personalView = await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${departingAdmin.token}`)
      .send({
        listPath: '/customers',
        name: 'My Personal View',
        href: '/customers?search=mine',
        visibility: 'PERSONAL',
      })
      .expect(201);

    const tenantView = await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${departingAdmin.token}`)
      .send({
        listPath: '/customers',
        name: 'Team View by Leaver',
        href: '/customers?search=team',
        visibility: 'TENANT',
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/tenant-members/${departingAdmin.membership.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);

    const [personalRow, tenantRow] = await runWithTenantContext(
      tenant.tenantId,
      () =>
        Promise.all([
          prisma.savedView.findFirst({
            where: { id: personalView.body.id, tenant_id: tenant.tenantId },
          }),
          prisma.savedView.findFirst({
            where: { id: tenantView.body.id, tenant_id: tenant.tenantId },
          }),
        ]),
    );
    expect(personalRow).toBeNull();
    expect(tenantRow).not.toBeNull();
    expect(tenantRow?.owner_user_id).toBeNull();
    expect(tenantRow?.version).toBe(tenantView.body.version + 1);

    const stalePatchRes = await request(app.getHttpServer())
      .patch(`/api/saved-views/${tenantView.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        name: 'Renamed by stale PATCH',
        version: tenantView.body.version,
      })
      .expect(409);
    expect(stalePatchRes.body.code).toBe('SAVED_VIEW_CHANGED');

    const afterStalePatch = await runWithTenantContext(tenant.tenantId, () =>
      prisma.savedView.findFirst({
        where: { id: tenantView.body.id, tenant_id: tenant.tenantId },
      }),
    );
    expect(afterStalePatch?.name).toBe('Team View by Leaver');
    expect(afterStalePatch?.visibility).toBe('TENANT');
    expect(afterStalePatch?.owner_user_id).toBeNull();
  });

  it('enforces optimistic concurrency (409 SAVED_VIEW_CHANGED) and duplicate name (409 SAVED_VIEW_DUPLICATE)', async () => {
    const tenant = await createTestTenant(prisma, 'sv-conc');
    tenantIds.push(tenant.tenantId);
    const token = createTestAuthToken(authService, tenant);

    const view1 = await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${token}`)
      .send({
        listPath: '/customers',
        name: 'Alpha',
        href: '/customers?search=alpha',
        visibility: 'PERSONAL',
      })
      .expect(201);

    const dupRes = await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${token}`)
      .send({
        listPath: '/customers',
        name: 'alpha',
        href: '/customers?search=alpha2',
        visibility: 'PERSONAL',
      })
      .expect(409);
    expect(dupRes.body.code).toBe('SAVED_VIEW_DUPLICATE');

    await request(app.getHttpServer())
      .patch(`/api/saved-views/${view1.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Alpha v2', version: 1 })
      .expect(200);

    const stalePatch = await request(app.getHttpServer())
      .patch(`/api/saved-views/${view1.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Stale', version: 1 })
      .expect(409);
    expect(stalePatch.body.code).toBe('SAVED_VIEW_CHANGED');

    const staleDelete = await request(app.getHttpServer())
      .delete(`/api/saved-views/${view1.body.id}?version=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(staleDelete.body.code).toBe('SAVED_VIEW_CHANGED');

    await request(app.getHttpServer())
      .delete(`/api/saved-views/${view1.body.id}?version=2`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  it('unsharing a TENANT view counts against the original owner personal limit and leaves row TENANT on 422', async () => {
    const tenant = await createTestTenant(prisma, 'sv-unshare-lim');
    tenantIds.push(tenant.tenantId);

    const ownerAdmin = await createMember(
      tenant.tenantId,
      'ADMIN',
      'sv-ul-owner',
    );
    const otherAdmin = await createMember(
      tenant.tenantId,
      'ADMIN',
      'sv-ul-other',
    );

    const shared = await request(app.getHttpServer())
      .post('/api/saved-views')
      .set('Authorization', `Bearer ${ownerAdmin.token}`)
      .send({
        listPath: '/customers',
        name: 'Shared View To Unshare',
        href: '/customers?search=shared',
        visibility: 'TENANT',
      })
      .expect(201);

    await runWithTenantContext(tenant.tenantId, () =>
      prisma.savedView.createMany({
        data: Array.from({ length: 50 }, (_, i) => ({
          tenant_id: tenant.tenantId,
          owner_user_id: ownerAdmin.user.id,
          list_path: '/customers',
          name: `Owner Personal ${i + 1}`,
          href: `/customers?search=p${i + 1}`,
          visibility: 'PERSONAL',
        })),
      }),
    );

    const unshareRes = await request(app.getHttpServer())
      .patch(`/api/saved-views/${shared.body.id}`)
      .set('Authorization', `Bearer ${otherAdmin.token}`)
      .send({ visibility: 'PERSONAL', version: shared.body.version })
      .expect(422);

    expect(unshareRes.body.code).toBe('SAVED_VIEW_LIMIT');

    const persisted = await runWithTenantContext(tenant.tenantId, () =>
      prisma.savedView.findFirst({
        where: { id: shared.body.id, tenant_id: tenant.tenantId },
      }),
    );
    expect(persisted?.visibility).toBe('TENANT');
    expect(persisted?.owner_user_id).toBe(ownerAdmin.user.id);
  });

  it('rejects DELETE /api/tenant-members/:id for non-admin roles with 403 and preserves membership', async () => {
    const tenant = await createTestTenant(prisma, 'sv-del-403');
    tenantIds.push(tenant.tenantId);

    const sales = await createMember(tenant.tenantId, 'SALES', 'sv-d403-sls');
    const tech = await createMember(tenant.tenantId, 'TECH', 'sv-d403-tch');

    await request(app.getHttpServer())
      .delete(`/api/tenant-members/${tech.membership.id}`)
      .set('Authorization', `Bearer ${sales.token}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/tenant-members/${sales.membership.id}`)
      .set('Authorization', `Bearer ${tech.token}`)
      .expect(403);

    const [salesRow, techRow] = await runWithTenantContext(
      tenant.tenantId,
      () =>
        Promise.all([
          prisma.tenantMember.findFirst({
            where: { id: sales.membership.id, tenant_id: tenant.tenantId },
          }),
          prisma.tenantMember.findFirst({
            where: { id: tech.membership.id, tenant_id: tenant.tenantId },
          }),
        ]),
    );
    expect(salesRow).not.toBeNull();
    expect(techRow).not.toBeNull();
  });
});
