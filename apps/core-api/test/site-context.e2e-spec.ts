import { createE2eApp } from './helpers/e2e-suite.js';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SiteService } from '../src/site/site.service.js';
import { DashboardRealtimeService } from '../src/dashboard-realtime/dashboard-realtime.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  runWithTenantContext,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('SiteContext / session site (AUT-256, rulings 7-9, 47)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let siteService: SiteService;
  let dashboardRealtime: DashboardRealtimeService;

  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;

  beforeAll(async () => {
    app = await createE2eApp();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
    siteService = app.get<SiteService>(SiteService);
    dashboardRealtime = app.get<DashboardRealtimeService>(
      DashboardRealtimeService,
    );
  });

  beforeEach(async () => {
    tenantA = await createTestTenant(prisma, 'aut256-ta');
    tenantB = await createTestTenant(prisma, 'aut256-tb');
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId).catch(
      () => undefined,
    );
    await cleanupTestTenantGraph(prisma, tenantB.tenantId).catch(
      () => undefined,
    );
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  const tenantAPrisma = () => createTenantAwarePrisma(prisma, tenantA.tenantId);
  const token = () => createTestAuthToken(authService, tenantA);

  async function mainSite() {
    return tenantAPrisma().site.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId, code: 'MAIN' },
    });
  }

  async function createSecondSite() {
    const tenantPrisma = tenantAPrisma();
    const legalEntity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });
    const user = await tenantPrisma.user.findFirstOrThrow({
      where: { email: tenantA.email },
    });
    const site = await runWithTenantContext(tenantA.tenantId, () =>
      siteService.createSite({
        legalEntityId: legalEntity.id,
        code: 'SECOND',
        name: 'Second Site',
      }),
    );
    await runWithTenantContext(tenantA.tenantId, () =>
      siteService.addSiteMembership(site.id, { userId: user.id }),
    );
    return site;
  }

  describe('GET /api/me/sites (ruling 47)', () => {
    it('lists only activatable sites for the current tenant', async () => {
      await mainSite();
      const res = await request(app.getHttpServer())
        .get('/api/me/sites')
        .set('Authorization', `Bearer ${token()}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        code: 'MAIN',
        legalEntityName: expect.any(String),
      });
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('legalEntityId');
    });

    it('omits a deactivated site even though the membership row remains', async () => {
      const second = await createSecondSite();
      await tenantAPrisma().site.update({
        where: { id: second.id },
        data: { is_active: false },
      });

      const res = await request(app.getHttpServer())
        .get('/api/me/sites')
        .set('Authorization', `Bearer ${token()}`)
        .expect(200);

      expect(res.body.map((site: { code: string }) => site.code)).toEqual([
        'MAIN',
      ]);
    });
  });

  describe('PATCH /api/me/active-site (ruling 9)', () => {
    it('switches the session active site and emits site_context_updated', async () => {
      const second = await createSecondSite();
      const contextSpy = jest
        .spyOn(dashboardRealtime, 'emitSiteContextUpdated')
        .mockImplementation(() => undefined);

      const res = await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', `Bearer ${token()}`)
        .send({ siteId: second.id })
        .expect(200);

      expect(res.body).toEqual({ activeSiteId: second.id });

      const user = await tenantAPrisma().user.findFirstOrThrow({
        where: { email: tenantA.email },
        select: { active_site_id: true },
      });
      expect(user.active_site_id).toBe(second.id);
      expect(contextSpy).toHaveBeenCalledWith(tenantA.firebaseUid, second.id);

      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token()}`)
        .expect(200);
      expect(me.body.activeSiteId).toBe(second.id);
    });

    it('clears the active site when siteId is null', async () => {
      const site = await mainSite();
      await tenantAPrisma().user.updateMany({
        where: { active_site_id: null },
        data: { active_site_id: site.id },
      });
      const contextSpy = jest
        .spyOn(dashboardRealtime, 'emitSiteContextUpdated')
        .mockImplementation(() => undefined);

      const res = await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', `Bearer ${token()}`)
        .send({ siteId: null })
        .expect(200);

      expect(res.body).toEqual({ activeSiteId: null });
      const user = await tenantAPrisma().user.findFirstOrThrow({
        where: { email: tenantA.email },
        select: { active_site_id: true },
      });
      expect(user.active_site_id).toBeNull();
      expect(contextSpy).toHaveBeenCalledWith(tenantA.firebaseUid, null);
    });

    it('rejects an inactive site with 422', async () => {
      const second = await createSecondSite();
      await tenantAPrisma().site.update({
        where: { id: second.id },
        data: { is_active: false },
      });

      await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', `Bearer ${token()}`)
        .send({ siteId: second.id })
        .expect(422);
    });

    it('rejects a site from another tenant', async () => {
      const tenantBPrisma = createTenantAwarePrisma(prisma, tenantB.tenantId);
      const siteB = await tenantBPrisma.site.findFirstOrThrow({
        where: { tenant_id: tenantB.tenantId },
      });

      await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', `Bearer ${token()}`)
        .send({ siteId: siteB.id })
        .expect(422);
    });

    it('rejects a site the caller has no active membership on', async () => {
      const tenantPrisma = tenantAPrisma();
      const legalEntity = await tenantPrisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantA.tenantId },
      });
      const unownedSite = await runWithTenantContext(tenantA.tenantId, () =>
        siteService.createSite({
          legalEntityId: legalEntity.id,
          code: 'NO-MEMBERSHIP',
          name: 'No Membership Site',
        }),
      );

      await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', `Bearer ${token()}`)
        .send({ siteId: unownedSite.id })
        .expect(422);
    });

    it('rejects a non-UUID siteId with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', `Bearer ${token()}`)
        .send({ siteId: 'not-a-uuid' })
        .expect(400);
    });
  });

  describe('mechanic mode (TECH) site recovery (AUT-780)', () => {
    async function createTechSession() {
      const suffix = randomUUID();
      const firebaseUid = `aut780-tech-${suffix}`;
      const email = `aut780-tech-${suffix}@workshop.local`;
      const main = await resolveTestMainSiteId(prisma, tenantA.tenantId);
      const userId = await runWithTenantContext(tenantA.tenantId, async () => {
        const user = await prisma.user.create({
          data: { firebaseUid, email },
        });
        await seedTestTenantMember(prisma, {
          tenantId: tenantA.tenantId,
          userId: user.id,
          role: 'TECH',
        });
        await prisma.siteMembership.create({
          data: {
            tenant_id: tenantA.tenantId,
            user_id: user.id,
            site_id: main,
            is_active: true,
          },
        });
        return user.id;
      });
      const techToken = authService.createTestToken({
        sub: firebaseUid,
        email,
        tenantId: tenantA.tenantId,
        role: 'TECH',
      });
      return { userId, mainSiteId: main, techToken };
    }

    async function createSiteWithoutMember() {
      const legalEntity = await tenantAPrisma().legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantA.tenantId },
      });
      return runWithTenantContext(tenantA.tenantId, () =>
        siteService.createSite({
          legalEntityId: legalEntity.id,
          code: 'TECH-OTHER',
          name: 'Other Site',
        }),
      );
    }

    it('lets a TECH session list only its own sites', async () => {
      const { techToken, mainSiteId } = await createTechSession();
      await createSiteWithoutMember();

      const res = await request(app.getHttpServer())
        .get('/api/me/sites')
        .set('Authorization', `Bearer ${techToken}`)
        .expect(200);

      expect(res.body.map((site: { id: string }) => site.id)).toEqual([
        mainSiteId,
      ]);
    });

    it('lets a TECH session switch to a site it belongs to and rejects one it does not', async () => {
      const { techToken, mainSiteId } = await createTechSession();
      const foreign = await createSiteWithoutMember();

      const ok = await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', `Bearer ${techToken}`)
        .send({ siteId: mainSiteId })
        .expect(200);
      expect(ok.body).toEqual({ activeSiteId: mainSiteId });

      await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', `Bearer ${techToken}`)
        .send({ siteId: foreign.id })
        .expect(422);
    });

    it('keeps other office endpoints closed to TECH sessions', async () => {
      const { techToken } = await createTechSession();

      await request(app.getHttpServer())
        .get('/api/sites')
        .set('Authorization', `Bearer ${techToken}`)
        .expect(403);
    });
  });

  describe('membership revoke clears the session site and emits (ruling 10)', () => {
    it('revoking the active-site membership nulls active_site_id and emits both events', async () => {
      const site = await mainSite();
      const user = await tenantAPrisma().user.findFirstOrThrow({
        where: { email: tenantA.email },
        select: { id: true },
      });
      await tenantAPrisma().user.update({
        where: { id: user.id },
        data: { active_site_id: site.id },
      });

      const contextSpy = jest
        .spyOn(dashboardRealtime, 'emitSiteContextUpdated')
        .mockImplementation(() => undefined);
      const scopeSpy = jest
        .spyOn(dashboardRealtime, 'emitSiteAccessScopeUpdated')
        .mockImplementation(() => undefined);

      await runWithTenantContext(tenantA.tenantId, () =>
        siteService.removeSiteMembership(site.id, user.id),
      );

      const after = await tenantAPrisma().user.findFirstOrThrow({
        where: { id: user.id },
        select: { active_site_id: true },
      });
      expect(after.active_site_id).toBeNull();
      expect(contextSpy).toHaveBeenCalledWith(tenantA.firebaseUid, null);
      expect(scopeSpy).toHaveBeenCalledWith(tenantA.firebaseUid);
    });
  });

  describe('site grant emits site_access_scope_updated (ruling 10)', () => {
    it('granting a site membership emits site_access_scope_updated to that user', async () => {
      const second = await createSecondSite();
      const user = await tenantAPrisma().user.findFirstOrThrow({
        where: { email: tenantA.email },
        select: { id: true },
      });
      await runWithTenantContext(tenantA.tenantId, () =>
        siteService.removeSiteMembership(second.id, user.id),
      );

      const scopeSpy = jest
        .spyOn(dashboardRealtime, 'emitSiteAccessScopeUpdated')
        .mockImplementation(() => undefined);

      await runWithTenantContext(tenantA.tenantId, () =>
        siteService.addSiteMembership(second.id, { userId: user.id }),
      );

      expect(scopeSpy).toHaveBeenCalledWith(tenantA.firebaseUid);
    });
  });
});
