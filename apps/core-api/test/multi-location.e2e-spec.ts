import { INestApplication, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { LocationService } from '../src/inventory/location.service';
import { SiteService } from '../src/site/site.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  type TestTenantResult,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';
describe('Multi-Location guards (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let locationService: LocationService;
  let siteService: SiteService;

  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
    locationService = app.get<LocationService>(LocationService);
    siteService = app.get<SiteService>(SiteService);
  });

  beforeEach(async () => {
    // Fresh tenants per test with the standard MAIN-site foundation.
    tenantA = await createTestTenant(prisma, 'aut252-ta');
    tenantB = await createTestTenant(prisma, 'aut252-tb');
  });

  afterEach(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId).catch(() => undefined);
    await cleanupTestTenantGraph(prisma, tenantB.tenantId).catch(() => undefined);
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  async function mainSite(tenantId: string) {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    return tenantPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenantId, code: 'MAIN' },
    });
  }

  async function transitLocation(tenantId: string, siteId: string) {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    return tenantPrisma.storageLocation.findFirstOrThrow({
      where: { tenant_id: tenantId, site_id: siteId, type: 'in_transit' },
    });
  }

  async function lotLocation(tenantId: string, siteId: string) {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    return tenantPrisma.storageLocation.findFirstOrThrow({
      where: { tenant_id: tenantId, site_id: siteId, type: 'vehicle_lot' },
    });
  }

  describe('cross-tenant composite FKs', () => {
    it('rejects a Site pointing at another tenant’s legal entity', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      const tenantBPrisma = createTenantAwarePrisma(prisma, tenantB.tenantId);
      const legalEntityB = await tenantBPrisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantB.tenantId },
      });

      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const attempt = tenantAPrisma.site.create({
        data: {
          tenant_id: tenantA.tenantId,
          legal_entity_id: legalEntityB.id,
          code: 'X-LEAK',
          name: 'Leak Site',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
          is_active: true,
        },
      });

      await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
      expect(siteA.id).toBeDefined();
    });

    it('rejects a SiteMembership for a user with no TenantMember (composite FK)', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      const tenantBPrisma = createTenantAwarePrisma(prisma, tenantB.tenantId);
      const userB = await tenantBPrisma.user.findFirstOrThrow({
        where: { email: tenantB.email },
      });

      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const attempt = tenantAPrisma.siteMembership.create({
        data: {
          tenant_id: tenantA.tenantId,
          user_id: userB.id,
          site_id: siteA.id,
          is_active: true,
        },
      });

      await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
    });

    it('rejects User.active_site_id pointing at another tenant’s site', async () => {
      const siteB = await mainSite(tenantB.tenantId);
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const userA = await tenantAPrisma.user.findFirstOrThrow({
        where: { email: tenantA.email },
      });

      const attempt = prisma.user.update({
        where: { id: userA.id },
        data: {
          active_tenant_id: tenantA.tenantId,
          active_site_id: siteB.id,
        },
      });

      await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
    });

    it('rejects a child location whose parent belongs to another site', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      const siteB = await mainSite(tenantB.tenantId);
      const tenantBPrisma = createTenantAwarePrisma(prisma, tenantB.tenantId);

      const binInB = await tenantBPrisma.storageLocation.create({
        data: {
          tenant_id: tenantB.tenantId,
          site_id: siteB.id,
          code: 'BIN-LEAK',
          name: 'Bin in B',
          type: 'bin',
        },
      });

      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const attempt = tenantAPrisma.storageLocation.create({
        data: {
          tenant_id: tenantA.tenantId,
          site_id: siteA.id,
          code: 'BIN-LEAK-CHILD',
          name: 'Child under other site',
          type: 'bin',
          parent_id: binInB.id,
        },
      });

      await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  describe('system-location delete guards', () => {
    it('LocationService.remove rejects the system in_transit location', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      const transit = await transitLocation(tenantA.tenantId, siteA.id);

      await expect(
        runWithTenantContext(tenantA.tenantId, () =>
          locationService.remove(transit.id),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('blocks lot soft-delete while a non-SOLD dealer vehicle is parked there', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      const lot = await lotLocation(tenantA.tenantId, siteA.id);
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);

      await tenantAPrisma.vehicle.create({
        data: {
          tenant_id: tenantA.tenantId,
          make: 'VW',
          model: 'Golf',
          year: 2020,
          inventory_role: 'USED',
          stock_status: 'IN_STOCK',
          location_id: lot.id,
        },
      });

      await expect(
        runWithTenantContext(tenantA.tenantId, () => locationService.remove(lot.id)),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets a lot soft-delete proceed once the vehicle is SOLD', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      const lot = await lotLocation(tenantA.tenantId, siteA.id);
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);

      await tenantAPrisma.vehicle.create({
        data: {
          tenant_id: tenantA.tenantId,
          make: 'VW',
          model: 'Golf',
          year: 2020,
          inventory_role: 'USED',
          stock_status: 'SOLD',
          location_id: lot.id,
        },
      });

      const result = await runWithTenantContext(tenantA.tenantId, () =>
        locationService.remove(lot.id),
      );
      expect(result.deletedAt).not.toBeNull();
    });
  });

  describe('site deactivation guards', () => {
    it('blocks deactivation while a parked dealer vehicle is on the site lot', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      const lot = await lotLocation(tenantA.tenantId, siteA.id);
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);

      await tenantAPrisma.vehicle.create({
        data: {
          tenant_id: tenantA.tenantId,
          make: 'BMW',
          model: '320i',
          year: 2021,
          inventory_role: 'NEW',
          stock_status: 'IN_PREP',
          location_id: lot.id,
        },
      });

      await expect(
        runWithTenantContext(tenantA.tenantId, () =>
          siteService.guardSiteDeactivation(tenantA.tenantId, siteA.id),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows deactivation for a clean site', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      await expect(
        runWithTenantContext(tenantA.tenantId, () =>
          siteService.guardSiteDeactivation(tenantA.tenantId, siteA.id),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('HTTP read authorization (P1-2 rulings 12/53)', () => {
    it('GET /api/legal-entities includes inactive rows by default for OWNER/ADMIN', async () => {
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const legalEntity = await tenantAPrisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantA.tenantId },
      });
      await tenantAPrisma.legalEntity.update({
        where: { id: legalEntity.id },
        data: { is_active: false },
      });

      const authHeader = `Bearer ${createTestAuthToken(authService, tenantA)}`;
      const res = await request(app.getHttpServer())
        .get('/legal-entities')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.some((le: { id: string }) => le.id === legalEntity.id)).toBe(
        true,
      );
    });

    it('GET /api/legal-entities forbids non-admins', async () => {
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const salesUser = await tenantAPrisma.user.create({
        data: {
          firebaseUid: `e2e-sales-http-${tenantA.tenantId}`,
          email: `sales-http-${tenantA.tenantId}@example.com`,
          active_tenant_id: tenantA.tenantId,
          active_site_id: null,
          memberships: {
            create: {
              tenant_id: tenantA.tenantId,
              role: 'SALES',
              is_active: true,
            },
          },
        },
      });

      const authHeader = `Bearer ${createTestAuthToken(authService, {
        ...tenantA,
        firebaseUid: salesUser.firebaseUid,
        email: salesUser.email,
      })}`;
      await request(app.getHttpServer())
        .get('/legal-entities')
        .set('Authorization', authHeader)
        .expect(403);
    });

    it('GET /api/sites?includeInactive=true forbids non-admins', async () => {
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const salesUser = await tenantAPrisma.user.create({
        data: {
          firebaseUid: `e2e-sales-http2-${tenantA.tenantId}`,
          email: `sales-http2-${tenantA.tenantId}@example.com`,
          active_tenant_id: tenantA.tenantId,
          active_site_id: null,
          memberships: {
            create: {
              tenant_id: tenantA.tenantId,
              role: 'SALES',
              is_active: true,
            },
          },
        },
      });

      const authHeader = `Bearer ${createTestAuthToken(authService, {
        ...tenantA,
        firebaseUid: salesUser.firebaseUid,
        email: salesUser.email,
      })}`;
      await request(app.getHttpServer())
        .get('/sites?includeInactive=true')
        .set('Authorization', authHeader)
        .expect(403);
    });
  });

  describe('vehicle-lot tenant-safety (P1-6)', () => {
    it('rejects a Vehicle whose lot belongs to another tenant', async () => {
      const siteB = await mainSite(tenantB.tenantId);
      const lotB = await lotLocation(tenantB.tenantId, siteB.id);
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);

      const attempt = tenantAPrisma.vehicle.create({
        data: {
          tenant_id: tenantA.tenantId,
          make: 'VW',
          model: 'Golf',
          year: 2020,
          inventory_role: 'USED',
          stock_status: 'IN_STOCK',
          location_id: lotB.id,
        },
      });

      await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  describe('site deactivation is rejected until the serialized guard lands (P1-3)', () => {
    it('PATCH updateSite isActive=false is rejected', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      await expect(
        runWithTenantContext(tenantA.tenantId, () =>
          siteService.updateSite(siteA.id, { isActive: false }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('site read authorization (P1-2)', () => {
    it('directory listSites requires at least one active SiteMembership', async () => {
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const noGrantUser = await tenantAPrisma.user.create({
        data: {
          firebaseUid: 'e2e-test-user',
          email: `no-grant-${tenantA.tenantId}@example.com`,
          active_tenant_id: tenantA.tenantId,
          active_site_id: null,
          memberships: {
            create: {
              tenant_id: tenantA.tenantId,
              role: 'ADMIN',
              is_active: true,
            },
          },
        },
        select: { id: true },
      });

      await expect(
        runWithTenantContext(tenantA.tenantId, () => siteService.listSites()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(noGrantUser.id).toBeDefined();
    });

    it('getSite requires membership or OWNER/ADMIN', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const salesUser = await tenantAPrisma.user.create({
        data: {
          firebaseUid: 'e2e-sales-user',
          email: `sales-${tenantA.tenantId}@example.com`,
          active_tenant_id: tenantA.tenantId,
          active_site_id: null,
          memberships: {
            create: {
              tenant_id: tenantA.tenantId,
              role: 'SALES',
              is_active: true,
            },
          },
        },
        select: { id: true },
      });

      // Sales role with no site membership → Forbidden on getSite.
      await expect(
        runWithTenantContext(
          tenantA.tenantId,
          () => siteService.getSite(siteA.id),
          { userId: 'e2e-sales-user', role: 'SALES' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(salesUser.id).toBeDefined();
    });

    it('getSite allows an active SiteMembership on that site', async () => {
      const siteA = await mainSite(tenantA.tenantId);
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const siteMember = await tenantAPrisma.user.create({
        data: {
          firebaseUid: 'e2e-site-member',
          email: `site-member-${tenantA.tenantId}@example.com`,
          active_tenant_id: tenantA.tenantId,
          active_site_id: null,
          memberships: {
            create: {
              tenant_id: tenantA.tenantId,
              role: 'SALES',
              is_active: true,
            },
          },
        },
        select: { id: true },
      });
      await tenantAPrisma.siteMembership.create({
        data: {
          tenant_id: tenantA.tenantId,
          user_id: siteMember.id,
          site_id: siteA.id,
          is_active: true,
        },
      });

      const result = await runWithTenantContext(
        tenantA.tenantId,
        () => siteService.getSite(siteA.id),
        { userId: 'e2e-site-member', role: 'SALES' },
      );
      expect(result.id).toBe(siteA.id);
    });
  });

  describe('create-to-delete lifecycle (P2-5)', () => {
    it('a pristine site created via createSite can be hard-deleted', async () => {
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const legalEntity = await tenantAPrisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantA.tenantId },
      });

      const created = await runWithTenantContext(tenantA.tenantId, () =>
        siteService.createSite({
          legalEntityId: legalEntity.id,
          code: 'TEST-SITE',
          name: 'Test Site',
        }),
      );

      const result = await runWithTenantContext(tenantA.tenantId, () =>
        siteService.deleteSite(created.id),
      );
      expect(result).toEqual({ deleted: true });

      const gone = await tenantAPrisma.site.findFirst({
        where: { tenant_id: tenantA.tenantId, id: created.id },
      });
      expect(gone).toBeNull();
    });
  });

  describe('all-inactive resolveDefaultSite regression (P1-8)', () => {
    it('resolveDefaultSiteId fails when the tenant has no active site', async () => {
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      await tenantAPrisma.site.updateMany({
        where: { tenant_id: tenantA.tenantId },
        data: { is_active: false },
      });

      await expect(
        runWithTenantContext(tenantA.tenantId, () =>
          siteService.resolveDefaultSiteId(tenantA.tenantId),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('migration invariants on a migrated tenant', () => {
    it('every tenant has exactly one active MAIN site and one in_transit location', async () => {
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const [sites, transitCount] = await Promise.all([
        tenantAPrisma.site.findMany({
          where: {
            tenant_id: tenantA.tenantId,
            is_active: true,
            code: 'MAIN',
          },
        }),
        tenantAPrisma.storageLocation.count({
          where: {
            tenant_id: tenantA.tenantId,
            type: 'in_transit',
            is_system: true,
          },
        }),
      ]);

      expect(sites).toHaveLength(1);
      expect(transitCount).toBe(1);
    });

    it('the MAIN site has exactly seven opening-hour rows', async () => {
      const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      const siteA = await mainSite(tenantA.tenantId);
      const rows = await tenantAPrisma.workshopOpeningHour.findMany({
        where: { tenant_id: tenantA.tenantId, site_id: siteA.id },
      });

      expect(rows).toHaveLength(7);
      expect(new Set(rows.map((row) => row.weekday)).size).toBe(7);
    });
  });
});
