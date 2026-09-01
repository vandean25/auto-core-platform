import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { SiteService } from './site.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const adminUser = {
  userId: 'fb-admin',
  email: 'admin@example.com',
  tenantId: TENANT_ID,
  role: 'ADMIN',
};

function createPrismaMock() {
  const mock = {
    legalEntity: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    site: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    siteMembership: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    tenantMember: {
      findFirst: jest.fn(),
    },
    storageLocation: {
      create: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    workshopOpeningHour: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    workshopHoliday: {
      deleteMany: jest.fn(),
    },
    vehicle: {
      count: jest.fn(),
    },
    inventoryStock: {
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(
    (callback: (tx: unknown) => unknown) => callback(mock),
  );
  return mock;
}

describe('SiteService', () => {
  let service: SiteService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let tenantContext: { getTenantId: jest.Mock; getAuthenticatedUser: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
      getAuthenticatedUser: jest.fn().mockReturnValue(adminUser),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SiteService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get(SiteService);
  });

  describe('createLegalEntity', () => {
    it('creates a legal entity with an AT/DE country', async () => {
      prisma.legalEntity.findFirst.mockResolvedValue(null);
      prisma.legalEntity.create.mockResolvedValue({
        id: 'le-1',
        tenant_id: TENANT_ID,
        name: 'AT GmbH',
        country_iso: 'AT',
      });

      const result = await service.createLegalEntity({
        name: 'AT GmbH',
        countryIso: 'AT',
      });

      expect(prisma.legalEntity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: TENANT_ID,
            country_iso: 'AT',
            is_active: true,
          }),
        }),
      );
      expect(result.country_iso).toBe('AT');
    });

    it('rejects a non-AT/DE country', async () => {
      await expect(
        service.createLegalEntity({
          name: 'CH GmbH',
          countryIso: 'CH' as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a duplicate name in the same tenant', async () => {
      prisma.legalEntity.findFirst.mockResolvedValue({ id: 'le-1' });
      await expect(
        service.createLegalEntity({ name: 'AT GmbH', countryIso: 'AT' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('forbids non-admins', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        ...adminUser,
        role: 'SALES',
      });
      await expect(
        service.createLegalEntity({ name: 'AT GmbH', countryIso: 'AT' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listLegalEntities (read authz, ruling 53)', () => {
    it('includes inactive rows by default and requires OWNER/ADMIN', async () => {
      prisma.legalEntity.findMany.mockResolvedValue([
        { id: 'le-active', is_active: true },
        { id: 'le-inactive', is_active: false },
      ]);

      const result = await service.listLegalEntities();

      expect(result).toHaveLength(2);
      expect(prisma.legalEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: TENANT_ID },
        }),
      );
    });

    it('hides inactive rows when includeInactive=false', async () => {
      prisma.legalEntity.findMany.mockResolvedValue([
        { id: 'le-active', is_active: true },
      ]);

      await service.listLegalEntities(false);

      expect(prisma.legalEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_active: true }),
        }),
      );
    });

    it('forbids non-admins', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        ...adminUser,
        role: 'SALES',
      });
      await expect(service.listLegalEntities()).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('listSites (directory read authz, rulings 12/53)', () => {
    it('lists the active names-only directory when the user has an active membership grant', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-relational' });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-1' });
      prisma.site.findMany.mockResolvedValue([
        {
          id: 'site-1',
          code: 'MAIN',
          name: 'Wien',
          legal_entity_id: 'le-1',
          legal_entity: { name: 'AT GmbH' },
        },
      ]);

      const result = await service.listSites();

      expect(result).toEqual([
        {
          id: 'site-1',
          code: 'MAIN',
          name: 'Wien',
          legalEntityId: 'le-1',
          legalEntityName: 'AT GmbH',
        },
      ]);
      expect(prisma.site.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: TENANT_ID, is_active: true },
        }),
      );
    });

    it('forbids the directory when the user has no active TenantMember', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-relational' });
      prisma.tenantMember.findFirst.mockResolvedValue(null);

      await expect(service.listSites()).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.site.findMany).not.toHaveBeenCalled();
    });

    it('forbids the directory when the user has no active SiteMembership', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-relational' });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.siteMembership.findFirst.mockResolvedValue(null);

      await expect(service.listSites()).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('includeInactive=true returns full rows and requires OWNER/ADMIN', async () => {
      prisma.site.findMany.mockResolvedValue([
        {
          id: 'site-1',
          is_active: false,
          openingHours: [],
          _count: { memberships: 0, bays: 0, storageLocations: 1 },
        },
      ]);

      const result = await service.listSites(true);

      expect(result).toHaveLength(1);
      expect(prisma.site.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: TENANT_ID },
        }),
      );
    });

    it('includeInactive=true forbids non-admins', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        ...adminUser,
        role: 'SALES',
      });
      await expect(service.listSites(true)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('getSite (read authz, rulings 44/53)', () => {
    it('allows OWNER/ADMIN without a membership row', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1' });

      const result = await service.getSite('site-1');
      expect(result.id).toBe('site-1');
      expect(prisma.siteMembership.findFirst).not.toHaveBeenCalled();
    });

    it('allows a user with an active SiteMembership on that site', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        ...adminUser,
        role: 'SALES',
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u-relational' });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-1' });
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1' });

      const result = await service.getSite('site-1');
      expect(result.id).toBe('site-1');
    });

    it('forbids a non-admin without membership on that site', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        ...adminUser,
        role: 'SALES',
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u-relational' });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.siteMembership.findFirst.mockResolvedValue(null);

      await expect(service.getSite('site-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('createSite', () => {
    it('creates a site with seven hours + TRANSIT atomically and derives AT defaults', async () => {
      prisma.legalEntity.findFirst.mockResolvedValue({
        id: 'le-1',
        is_active: true,
        country_iso: 'AT',
      });
      prisma.site.findFirst.mockResolvedValue(null);
      prisma.site.create.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        legal_entity_id: 'le-1',
        code: 'MAIN',
      });
      prisma.workshopOpeningHour.createMany.mockResolvedValue({ count: 7 });
      prisma.storageLocation.create.mockResolvedValue({
        id: 'transit-1',
        is_system: true,
        type: 'in_transit',
      });

      const result = await service.createSite({
        legalEntityId: 'le-1',
        code: 'MAIN',
        name: 'Wien',
      });

      expect(result.id).toBe('site-1');
      expect(prisma.site.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timezone: 'Europe/Vienna',
            holiday_country_iso: 'AT',
            slot_minutes: 30,
          }),
        }),
      );
      expect(prisma.workshopOpeningHour.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([expect.any(Object)]) }),
      );
      expect(prisma.storageLocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'TRANSIT',
            type: 'in_transit',
            is_system: true,
          }),
        }),
      );
      // No default LOT is created for new sites (create-to-delete invariant).
      expect(prisma.storageLocation.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'vehicle_lot' }),
        }),
      );
    });

    it('derives DE defaults from the legal entity country', async () => {
      prisma.legalEntity.findFirst.mockResolvedValue({
        id: 'le-1',
        is_active: true,
        country_iso: 'DE',
      });
      prisma.site.findFirst.mockResolvedValue(null);
      prisma.site.create.mockResolvedValue({ id: 'site-1' });
      prisma.workshopOpeningHour.createMany.mockResolvedValue({ count: 7 });
      prisma.storageLocation.create.mockResolvedValue({ id: 'transit-1' });

      await service.createSite({
        legalEntityId: 'le-1',
        code: 'MUC',
        name: 'München',
      });

      expect(prisma.site.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timezone: 'Europe/Berlin',
            holiday_country_iso: 'DE',
          }),
        }),
      );
    });

    it('rejects a site under an inactive legal entity with 422', async () => {
      prisma.legalEntity.findFirst.mockResolvedValue({
        id: 'le-1',
        is_active: false,
      });

      await expect(
        service.createSite({ legalEntityId: 'le-1', code: 'W', name: 'Wien' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.site.create).not.toHaveBeenCalled();
    });

    it('runs site + hours + TRANSIT inside a single transaction (rollback safety)', async () => {
      prisma.legalEntity.findFirst.mockResolvedValue({
        id: 'le-1',
        is_active: true,
        country_iso: 'AT',
      });
      prisma.site.findFirst.mockResolvedValue(null);
      prisma.site.create.mockResolvedValue({ id: 'site-1' });
      prisma.workshopOpeningHour.createMany.mockResolvedValue({ count: 7 });
      prisma.storageLocation.create.mockRejectedValue(
        new Error('transit insert failed'),
      );
      prisma.$transaction.mockImplementation(() => {
        throw new Error('transaction aborted');
      });

      await expect(
        service.createSite({ legalEntityId: 'le-1', code: 'MAIN', name: 'Wien' }),
      ).rejects.toThrow('transaction aborted');

      // The whole create flow is wrapped in $transaction, so a mid-way
      // failure cannot leave a half-created Site behind.
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rejects a legal entity of another tenant (cross-tenant FK protection)', async () => {
      prisma.legalEntity.findFirst.mockResolvedValue(null);
      await expect(
        service.createSite({ legalEntityId: 'le-other-tenant', code: 'W', name: 'Wien' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateSite', () => {
    it('rejects any attempt to change legal_entity_id (immutable)', async () => {
      await expect(
        service.updateSite('site-1', {
          legalEntityId: 'le-2',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects deactivation until the serialized guard lands (ruling 41)', async () => {
      prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        legal_entity_id: 'le-1',
        is_active: true,
      });

      await expect(
        service.updateSite('site-1', { isActive: false }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.site.update).not.toHaveBeenCalled();
    });

    it('blocks reactivation when the parent legal entity is inactive', async () => {
      prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        legal_entity_id: 'le-1',
        is_active: false,
      });
      prisma.legalEntity.findFirst.mockResolvedValue({ is_active: false });

      await expect(
        service.updateSite('site-1', { isActive: true }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('allows name/address updates', async () => {
      prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        legal_entity_id: 'le-1',
        is_active: true,
      });
      prisma.site.update.mockResolvedValue({ id: 'site-1', name: 'Wien Süd' });

      const result = await service.updateSite('site-1', { name: 'Wien Süd' });
      expect(result.name).toBe('Wien Süd');
    });
  });

  describe('deleteSite', () => {
    it('blocks hard delete when the site has memberships', async () => {
      prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        storageLocations: [],
        _count: {
          memberships: 1,
          bays: 0,
          storageLocations: 0,
          openingHours: 0,
          holidays: 0,
        },
      });

      await expect(service.deleteSite('site-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('deletes a pristine site together with its empty system transit location', async () => {
      prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        storageLocations: [
          { id: 'transit-1', is_system: true, type: 'in_transit' },
        ],
        _count: {
          memberships: 0,
          bays: 0,
          storageLocations: 1,
          openingHours: 0,
          holidays: 0,
        },
      });
      prisma.vehicle.count.mockResolvedValue(0);
      prisma.storageLocation.deleteMany.mockResolvedValue({ count: 1 });
      prisma.workshopOpeningHour.deleteMany.mockResolvedValue({ count: 0 });
      prisma.workshopHoliday.deleteMany.mockResolvedValue({ count: 0 });
      prisma.site.delete.mockResolvedValue({ id: 'site-1' });

      const result = await service.deleteSite('site-1');
      expect(result).toEqual({ deleted: true });
      expect(prisma.storageLocation.deleteMany).toHaveBeenCalled();
      expect(prisma.site.delete).toHaveBeenCalled();
    });

    it('blocks hard delete when a non-system storage location exists', async () => {
      prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        storageLocations: [{ id: 'warehouse-1', is_system: false }],
        _count: {
          memberships: 0,
          bays: 0,
          storageLocations: 1,
          openingHours: 0,
          holidays: 0,
        },
      });

      await expect(service.deleteSite('site-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('resolveDefaultSiteId (ruling 11/53)', () => {
    it('returns the first active site', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-active' });

      const id = await service.resolveDefaultSiteId(TENANT_ID);
      expect(id).toBe('site-active');
      expect(prisma.site.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: TENANT_ID, is_active: true },
        }),
      );
    });

    it('fails when the tenant has no active site (all-inactive regression)', async () => {
      prisma.site.findFirst.mockResolvedValue(null);

      await expect(service.resolveDefaultSiteId(TENANT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('addSiteMembership', () => {
    it('adds a membership for an active TenantMember', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1' });
      prisma.tenantMember.findFirst.mockResolvedValue({
        id: 'tm-1',
        is_active: true,
      });
      prisma.siteMembership.findFirst.mockResolvedValue(null);
      prisma.siteMembership.create.mockResolvedValue({
        id: 'sm-1',
        site_id: 'site-1',
      });

      const result = await service.addSiteMembership('site-1', {
        userId: 'u-2',
      });
      expect(result.id).toBe('sm-1');
    });

    it('rejects a user with no TenantMember in the tenant', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1' });
      prisma.tenantMember.findFirst.mockResolvedValue(null);

      await expect(
        service.addSiteMembership('site-1', { userId: 'u-2' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an inactive TenantMember with 422', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1' });
      prisma.tenantMember.findFirst.mockResolvedValue({
        id: 'tm-1',
        is_active: false,
      });

      await expect(
        service.addSiteMembership('site-1', { userId: 'u-2' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('removeSiteMembership', () => {
    it('clears active_site_id when the removed membership matches', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1' });
      prisma.siteMembership.findFirst.mockResolvedValue({
        id: 'sm-1',
        site_id: 'site-1',
        user_id: 'u-1',
      });

      await service.removeSiteMembership('site-1', 'u-1');

      expect(prisma.siteMembership.delete).toHaveBeenCalledWith({
        where: { id: 'sm-1' },
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { active_site_id: 'site-1', id: 'u-1' },
        data: { active_site_id: null },
      });
    });
  });
});
