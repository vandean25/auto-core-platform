import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TenantMemberRole } from '@prisma/client';
import { getFirebaseAdminAuth } from '../src/auth/firebase-admin.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SiteService } from '../src/site/site.service.js';
import { UserAccessStatusService } from '../src/auth/user-access-status.service.js';
import { advanceScopeEpoch } from '../src/auth/scope-epoch.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('scope epoch writers (AUT-934)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let siteService: SiteService;
  let userAccessStatus: UserAccessStatusService;
  let tenant: TestTenantResult;

  beforeAll(async () => {
    const firebaseAuth = getFirebaseAdminAuth();
    jest
      .spyOn(firebaseAuth, 'getUser')
      .mockResolvedValue({ customClaims: {} });
    jest.spyOn(firebaseAuth, 'setCustomUserClaims').mockResolvedValue(undefined);
    jest.spyOn(firebaseAuth, 'revokeRefreshTokens').mockResolvedValue(undefined);

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
    await cleanupTestTenantGraph(prisma, tenant.tenantId).catch(() => undefined);
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  const token = () => createTestAuthToken(authService, tenant);
  const tenantPrisma = () => createTenantAwarePrisma(prisma, tenant.tenantId);

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

  it('epoch atomic with writer', async () => {
    const user = await tenantPrisma().user.findFirstOrThrow({
      where: { email: tenant.email },
    });
    const site = await tenantPrisma().site.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, code: 'MAIN' },
    });
    const beforeEpoch = await memberEpoch(user.id);

    await expect(
      runWithTenantContext(tenant.tenantId, () =>
        prisma.$transaction(async (tx) => {
          const membership = await tx.siteMembership.findFirstOrThrow({
            where: {
              tenant_id: tenant.tenantId,
              site_id: site.id,
              user_id: user.id,
            },
          });
          await tx.siteMembership.delete({ where: { id: membership.id } });
          await advanceScopeEpoch(tx, {
            kind: 'member',
            tenantId: tenant.tenantId,
            userId: user.id,
          });
          throw new Error('rollback');
        }),
      ),
    ).rejects.toThrow('rollback');

    expect(await memberEpoch(user.id)).toBe(beforeEpoch);
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

    await cleanupTestTenantGraph(prisma, other.tenantId).catch(() => undefined);
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
