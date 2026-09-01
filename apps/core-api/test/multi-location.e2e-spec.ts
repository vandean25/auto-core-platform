import { INestApplication, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { LocationService } from '../src/inventory/location.service';
import { SiteService } from '../src/site/site.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  runWithTenantContext,
  type TestTenantResult,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Multi-Location guards (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
