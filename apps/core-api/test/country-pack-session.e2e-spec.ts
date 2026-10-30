import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { UserRecord } from 'firebase-admin/auth';
import request from 'supertest';
import { createE2eApp } from './helpers/e2e-suite.js';
import { getFirebaseAdminAuth } from '../src/auth/firebase-admin.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const atCapabilities = {
  nova: true,
  pickerl57a: true,
  kaufvertragAt: true,
  willhabenExport: true,
};
const deCapabilities = {
  nova: false,
  pickerl57a: false,
  kaufvertragAt: false,
  willhabenExport: false,
};

describe('Country pack session capabilities', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;

  beforeAll(async () => {
    const firebaseAuth = getFirebaseAdminAuth();
    jest
      .spyOn(firebaseAuth, 'getUser')
      .mockResolvedValue({ customClaims: {} } as UserRecord);
    jest
      .spyOn(firebaseAuth, 'setCustomUserClaims')
      .mockResolvedValue(undefined);
    app = await createE2eApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    tenantA = await createTestTenant(prisma, 'country-pack-at');
    tenantB = await createTestTenant(prisma, 'country-pack-de');
    await createTenantAwarePrisma(
      prisma,
      tenantB.tenantId,
    ).legalEntity.updateMany({
      where: { tenant_id: tenantB.tenantId },
      data: { country_iso: 'DE' },
    });
  });

  afterEach(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId);
    await cleanupTestTenantGraph(prisma, tenantB.tenantId);
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
    jest.restoreAllMocks();
  });

  async function session(tenant: TestTenantResult, claimedTenantId?: string) {
    return request(app.getHttpServer())
      .get('/api/auth/me')
      .set(
        'Authorization',
        `Bearer ${createTestAuthToken(
          app.get(AuthService),
          tenant,
          claimedTenantId ? { tenantId: claimedTenantId } : {},
        )}`,
      );
  }

  it('returns AT capabilities for the active Austrian legal entity', async () => {
    const res = await session(tenantA);
    expect(res.status).toBe(200);
    expect(res.body.effectiveCapabilities).toEqual(atCapabilities);
  });

  it('returns DE capabilities for the active German legal entity', async () => {
    const res = await session(tenantB);
    expect(res.status).toBe(200);
    expect(res.body.effectiveCapabilities).toEqual(deCapabilities);
  });

  it('uses server-side tenant membership rather than token tenant claims', async () => {
    const res = await session(tenantA, tenantB.tenantId);
    expect(res.status).toBe(200);
    expect(res.body.activeTenant.id).toBe(tenantA.tenantId);
    expect(res.body.effectiveCapabilities).toEqual(atCapabilities);
  });

  it('refreshes capabilities when switching legal entities within a tenant', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const user = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenantA.firebaseUid },
    });
    const legalEntity = await tenantPrisma.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: 'Synthetic German seller',
        country_iso: 'DE',
        is_active: true,
      },
    });
    const site = await tenantPrisma.site.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: legalEntity.id,
        code: 'GERMAN',
        name: 'Synthetic German site',
        timezone: 'Europe/Berlin',
        holiday_country_iso: 'DE',
        is_active: true,
      },
    });
    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenantA.tenantId,
        user_id: user.id,
        site_id: site.id,
        is_active: true,
      },
    });
    expect((await session(tenantA)).body.effectiveCapabilities).toEqual(
      atCapabilities,
    );
    await request(app.getHttpServer())
      .patch('/api/me/active-site')
      .set(
        'Authorization',
        `Bearer ${createTestAuthToken(app.get(AuthService), tenantA)}`,
      )
      .send({ siteId: site.id })
      .expect(200);
    const res = await session(tenantA);
    expect(res.status).toBe(200);
    expect(res.body.activeSiteId).toBe(site.id);
    expect(res.body.effectiveCapabilities).toEqual(deCapabilities);
  });

  async function grantSecondTenantMembership() {
    const user = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenantA.firebaseUid },
    });
    await createTenantAwarePrisma(prisma, tenantB.tenantId).tenantMember.create(
      {
        data: {
          tenant_id: tenantB.tenantId,
          user_id: user.id,
          role: 'ADMIN',
          is_active: true,
        },
      },
    );
  }

  it.each(['tenant switch', 'membership fallback'] as const)(
    'clears site and capabilities after %s',
    async (transition) => {
      await grantSecondTenantMembership();
      const clearedContext = {
        activeTenant: { id: tenantB.tenantId },
        activeSiteId: null,
        effectiveCapabilities: null,
      };
      if (transition === 'tenant switch') {
        const switched = await request(app.getHttpServer())
          .post('/api/auth/switch-tenant')
          .set(
            'Authorization',
            `Bearer ${createTestAuthToken(app.get(AuthService), tenantA)}`,
          )
          .send({ tenantId: tenantB.tenantId });
        expect(switched.status).toBe(200);
        expect(switched.body).toMatchObject(clearedContext);
      } else {
        await createTenantAwarePrisma(
          prisma,
          tenantA.tenantId,
        ).tenantMember.updateMany({
          where: {
            tenant_id: tenantA.tenantId,
            user: { firebaseUid: tenantA.firebaseUid },
          },
          data: { is_active: false },
        });
      }
      const res = await session(tenantA);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject(clearedContext);
    },
  );

  it('returns null capabilities without an active site', async () => {
    await prisma.user.updateMany({
      where: { firebaseUid: tenantA.firebaseUid },
      data: { active_site_id: null },
    });
    const res = await session(tenantA);
    expect(res.status).toBe(200);
    expect(res.body.effectiveCapabilities).toBeNull();
  });

  it.each(['siteMembership', 'site', 'legalEntity'] as const)(
    'returns null after the active %s is deactivated',
    async (model) => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const mutation = {
        where: { tenant_id: tenantA.tenantId },
        data: { is_active: false },
      };
      const deactivate = {
        siteMembership: () => tenantPrisma.siteMembership.updateMany(mutation),
        site: () => tenantPrisma.site.updateMany(mutation),
        legalEntity: () => tenantPrisma.legalEntity.updateMany(mutation),
      };
      await deactivate[model]();
      const res = await session(tenantA);
      expect(res.status).toBe(200);
      expect(res.body.effectiveCapabilities).toBeNull();
    },
  );

  it('rejects a user whose tenant membership has been revoked', async () => {
    await createTenantAwarePrisma(
      prisma,
      tenantA.tenantId,
    ).tenantMember.updateMany({
      where: { tenant_id: tenantA.tenantId },
      data: { is_active: false },
    });
    const res = await session(tenantA);
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('effectiveCapabilities');
  });
});
