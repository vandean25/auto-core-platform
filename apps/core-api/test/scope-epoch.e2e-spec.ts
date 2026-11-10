import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TenantMemberRole, type Prisma, type PrismaClient } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SiteService } from '../src/site/site.service.js';
import { UserAccessStatusService } from '../src/auth/user-access-status.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestUsers,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestPlatformAdmin,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { stubFirebaseAdminAuthForCustomClaimsE2e } from './helpers/firebase-auth-e2e-mocks.js';
import { cleanupE2eTenantGraph, teardownTestApp } from './test-lifecycle.js';

describe('scope epoch writers (AUT-934)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let siteService: SiteService;
  let userAccessStatus: UserAccessStatusService;
  let tenant: TestTenantResult;

  beforeAll(async () => {
    stubFirebaseAdminAuthForCustomClaimsE2e();
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    siteService = app.get(SiteService);
    userAccessStatus = app.get(UserAccessStatusService);
  });

  beforeEach(async () => {
    tenant = await createTestTenant(prisma, 'scope-epoch');
  });

  afterEach(async () => {
    await cleanupE2eTenantGraph(prisma, tenant.tenantId);
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  const token = () => createTestAuthToken(authService, tenant);
  const tenantPrisma = () => createTenantAwarePrisma(prisma, tenant.tenantId);

  async function mainSiteAdminUser() {
    const user = await tenantPrisma().user.findFirstOrThrow({
      where: { email: tenant.email },
    });
    const site = await tenantPrisma().site.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, code: 'MAIN' },
    });
    return { user, site };
  }

  async function memberEpoch(userId: string) {
    const row = await tenantPrisma().tenantMember.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, user_id: userId },
      select: { scope_epoch: true },
    });
    return row.scope_epoch;
  }

  async function tenantAuthorizationEpoch() {
    const row = await prisma.tenant.findFirstOrThrow({
      where: { id: tenant.tenantId },
      select: { authorization_epoch: true },
    });
    return row.authorization_epoch;
  }

  it('A→B→A advances twice', async () => {
    const tech = await tenantPrisma().user.create({
      data: {
        firebaseUid: `scope-epoch-tech-${Date.now()}`,
        email: `scope-epoch-tech-${Date.now()}@example.com`,
      },
    });
    await seedTestTenantMember(prisma, {
      tenantId: tenant.tenantId,
      userId: tech.id,
      role: 'TECH',
    });
    const membership = await tenantPrisma().tenantMember.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, user_id: tech.id },
    });
    const before = await memberEpoch(tech.id);

    await request(app.getHttpServer())
      .patch(`/api/tenant-members/${membership.id}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ role: TenantMemberRole.ADMIN })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/tenant-members/${membership.id}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ role: TenantMemberRole.TECH })
      .expect(200);

    const after = await memberEpoch(tech.id);
    expect(after - before).toBe(2n);
  });

  it('removeSiteMembership rolls back epoch and row on transaction failure', async () => {
    const { user, site } = await mainSiteAdminUser();
    const membership = await tenantPrisma().siteMembership.findFirstOrThrow({
      where: {
        tenant_id: tenant.tenantId,
        site_id: site.id,
        user_id: user.id,
      },
    });
    const beforeEpoch = await memberEpoch(user.id);

    const innerClient: PrismaClient = prisma.client;
    const originalTransaction = innerClient.$transaction.bind(innerClient);
    type TransactionFn = Parameters<PrismaClient['$transaction']>[0];
    type TransactionOptions = Parameters<PrismaClient['$transaction']>[1];
    const failingTransaction = ((
      fn: TransactionFn,
      options?: TransactionOptions,
    ) =>
      originalTransaction(async (tx) => {
        const deleteMembership = tx.siteMembership.delete.bind(tx.siteMembership);
        const wrappedTx = Object.assign(tx, {
          siteMembership: Object.assign(tx.siteMembership, {
            delete: async (args: Prisma.SiteMembershipDeleteArgs) => {
              await deleteMembership(args);
              throw new Error('forced rollback');
            },
          }),
        });
        return fn(wrappedTx);
      }, options)) as typeof innerClient.$transaction;
    innerClient.$transaction = failingTransaction;

    await expect(
      runWithTenantContext(tenant.tenantId, () =>
        siteService.removeSiteMembership(site.id, user.id),
      ),
    ).rejects.toThrow('forced rollback');

    innerClient.$transaction = originalTransaction;

    expect(await memberEpoch(user.id)).toBe(beforeEpoch);
    const stillThere = await tenantPrisma().siteMembership.findFirst({
      where: { id: membership.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it('removeSiteMembership commits epoch increment', async () => {
    const { user, site } = await mainSiteAdminUser();
    const beforeEpoch = await memberEpoch(user.id);

    await runWithTenantContext(tenant.tenantId, () =>
      siteService.removeSiteMembership(site.id, user.id),
    );

    expect((await memberEpoch(user.id)) - beforeEpoch).toBe(1n);
    await expect(
      tenantPrisma().siteMembership.findFirstOrThrow({
        where: {
          tenant_id: tenant.tenantId,
          site_id: site.id,
          user_id: user.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('tenant epoch on activation', async () => {
    const site = await tenantPrisma().site.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, code: 'MAIN' },
    });
    const before = await tenantAuthorizationEpoch();

    await tenantPrisma().site.update({
      where: { id: site.id },
      data: { is_active: false },
    });

    await runWithTenantContext(tenant.tenantId, () =>
      siteService.updateSite(site.id, { isActive: true }),
    );

    expect(await tenantAuthorizationEpoch() - before).toBe(1n);
  });

  it('legal entity isActive change bumps authorization epoch', async () => {
    const inactiveEntity = await tenantPrisma().legalEntity.create({
      data: {
        tenant_id: tenant.tenantId,
        name: `Scope epoch inactive LE ${Date.now()}`,
        country_iso: 'AT',
        is_active: false,
      },
    });
    const before = await tenantAuthorizationEpoch();

    await request(app.getHttpServer())
      .patch(`/api/legal-entities/${inactiveEntity.id}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ isActive: true })
      .expect(200);

    expect(await tenantAuthorizationEpoch() - before).toBe(1n);
  });

  it('platform tenant isActive change bumps authorization epoch', async () => {
    const platformAdmin = await createTestPlatformAdmin(prisma);
    try {
      const before = await tenantAuthorizationEpoch();
      const platformToken = authService.createTestToken({
        sub: platformAdmin.firebaseUid,
        email: platformAdmin.email,
        platformRole: 'SUPER_ADMIN',
      });

      await request(app.getHttpServer())
        .patch(`/api/platform/tenants/${tenant.tenantId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ isActive: false })
        .expect(200);

      expect(await tenantAuthorizationEpoch() - before).toBe(1n);

      await request(app.getHttpServer())
        .patch(`/api/platform/tenants/${tenant.tenantId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ isActive: true })
        .expect(200);
    } finally {
      await cleanupTestUsers(prisma, [platformAdmin.userId]);
    }
  });

  it('user status advances all memberships', async () => {
    const other = await createTestTenant(
      prisma,
      `scope-epoch-other-${Date.now()}`,
    );
    const sharedUser = await prisma.user.create({
      data: {
        firebaseUid: `scope-epoch-multi-${Date.now()}`,
        email: `scope-epoch-multi-${Date.now()}@example.com`,
      },
    });
    await seedTestTenantMember(prisma, {
      tenantId: tenant.tenantId,
      userId: sharedUser.id,
      role: 'TECH',
    });
    await seedTestTenantMember(prisma, {
      tenantId: other.tenantId,
      userId: sharedUser.id,
      role: 'TECH',
    });
    const beforeA = await readEpoch(tenant.tenantId, sharedUser.id);
    const beforeB = await readEpoch(other.tenantId, sharedUser.id);

    await userAccessStatus.advanceAllMembershipEpochs(sharedUser.id);

    expect((await readEpoch(tenant.tenantId, sharedUser.id)) - beforeA).toBe(1n);
    expect((await readEpoch(other.tenantId, sharedUser.id)) - beforeB).toBe(1n);

    await cleanupE2eTenantGraph(prisma, other.tenantId);
  });

  async function readEpoch(tenantId: string, userId: string) {
    return runWithTenantContext(tenantId, async () => {
      const row = await createTenantAwarePrisma(
        prisma,
        tenantId,
      ).tenantMember.findFirstOrThrow({
        where: { tenant_id: tenantId, user_id: userId },
        select: { scope_epoch: true },
      });
      return row.scope_epoch;
    });
  }
});
