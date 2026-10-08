import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Workshop KPI reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let foreignTenantId: string;
  let tenantSiteId: string;
  let unassignedSiteId: string;
  let foreignSiteId: string;
  let adminToken: string;
  let ownerToken: string;
  let salesToken: string;
  let techToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    const tenant = await createTestTenant(prisma, 'workshop-kpi');
    tenantId = tenant.tenantId;
    adminToken = createTestAuthToken(auth, tenant);
    const foreignTenant = await createTestTenant(prisma, 'workshop-kpi-foreign');
    foreignTenantId = foreignTenant.tenantId;

    tenantSiteId = await runWithTenantContext(tenantId, async () => {
      const site = await prisma.site.findFirstOrThrow({ where: { tenant_id: tenantId }, select: { id: true } });
      const legalEntity = await prisma.legalEntity.findFirstOrThrow({ where: { tenant_id: tenantId }, select: { id: true } });
      const secondSite = await prisma.site.create({
        data: {
          tenant_id: tenantId, legal_entity_id: legalEntity.id, code: 'SECOND', name: 'Second site',
          timezone: 'Europe/Vienna', slot_minutes: 30, holiday_country_iso: 'AT', is_active: true,
        },
      });
      unassignedSiteId = secondSite.id;
      return site.id;
    });
    foreignSiteId = await runWithTenantContext(foreignTenant.tenantId, async () => (
      await prisma.site.findFirstOrThrow({ where: { tenant_id: foreignTenant.tenantId }, select: { id: true } })
    ).id);

    await runWithTenantContext(tenantId, async () => {
      const owner = await prisma.user.create({ data: { firebaseUid: `kpi-owner-${tenantId}`, email: `kpi-owner-${tenantId}@test.local` } });
      await seedTestTenantMember(prisma, { tenantId, userId: owner.id, role: 'OWNER' });
      await prisma.siteMembership.create({ data: { tenant_id: tenantId, user_id: owner.id, site_id: tenantSiteId, is_active: true } });
      ownerToken = auth.createTestToken({ sub: owner.firebaseUid, email: owner.email, tenantId, role: 'OWNER' });

      const user = await prisma.user.create({ data: { firebaseUid: `kpi-sales-${tenantId}`, email: `kpi-sales-${tenantId}@test.local` } });
      await seedTestTenantMember(prisma, { tenantId, userId: user.id, role: 'SALES' });
      await prisma.siteMembership.create({ data: { tenant_id: tenantId, user_id: user.id, site_id: tenantSiteId, is_active: true } });
      salesToken = auth.createTestToken({ sub: user.firebaseUid, email: user.email, tenantId, role: 'SALES' });

      const tech = await prisma.user.create({ data: { firebaseUid: `kpi-tech-${tenantId}`, email: `kpi-tech-${tenantId}@test.local` } });
      await seedTestTenantMember(prisma, { tenantId, userId: tech.id, role: 'TECH' });
      await prisma.siteMembership.create({ data: { tenant_id: tenantId, user_id: tech.id, site_id: tenantSiteId, is_active: true } });
      techToken = auth.createTestToken({ sub: tech.firebaseUid, email: tech.email, tenantId, role: 'TECH' });
    });
  });

  afterAll(async () => {
    if (tenantId) await cleanupTestTenantGraph(prisma, tenantId);
    if (foreignTenantId) await cleanupTestTenantGraph(prisma, foreignTenantId);
    await teardownTestApp(app);
  });

  function report(token: string, siteId = tenantSiteId) {
    return request(app.getHttpServer())
      .get('/api/reports/workshop-kpis')
      .query({ siteId, from: '2026-01-01', to: '2026-01-31', groupBy: 'mechanic' })
      .set('Authorization', `Bearer ${token}`);
  }

  it.each(['OWNER', 'ADMIN', 'SALES'])('permits %s to read an authorized site', async (role) => {
    const token = role === 'OWNER' ? ownerToken : role === 'SALES' ? salesToken : adminToken;
    await report(token).expect(200);
  });

  it('denies TECH', async () => {
    await report(techToken).expect(403);
  });

  it('isolates unauthorized sites within and across tenants', async () => {
    await report(adminToken, unassignedSiteId).expect(404);
    await report(adminToken, foreignSiteId).expect(404);
  });

  it('validates the date range and grouping query', async () => {
    await request(app.getHttpServer()).get('/api/reports/workshop-kpis')
      .query({ siteId: tenantSiteId, from: '2026-02-01', to: '2026-01-01' })
      .set('Authorization', `Bearer ${adminToken}`).expect(400);
    await request(app.getHttpServer()).get('/api/reports/workshop-kpis')
      .query({ siteId: tenantSiteId, from: '2026-01-01', to: '2026-01-31', groupBy: 'day' })
      .set('Authorization', `Bearer ${adminToken}`).expect(400);
  });
});
