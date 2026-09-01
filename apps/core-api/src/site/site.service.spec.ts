import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { SiteService } from './site.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const adminUser = {
  userId: 'u-1',
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
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    workshopOpeningHour: {
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
      updateMany: jest.fn(),
    },
    $executeRaw: jest.fn(),
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
      tenantContext.getAuthenticatedUser.mockReturnValue({ ...adminUser, role: 'SALES' });
      await expect(
        service.createLegalEntity({ name: 'AT GmbH', countryIso: 'AT' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('createSite', () => {
    it('creates a site under an active legal entity with system locations', async () => {
      prisma.legalEntity.findFirst.mockResolvedValue({
        id: 'le-1',
        is_active: true,
      });
      prisma.site.findFirst.mockResolvedValue(null);
      prisma.site.create.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        legal_entity_id: 'le-1',
        code: 'MAIN',
      });
      prisma.storageLocation.createMany.mockResolvedValue({ count: 2 });

      const result = await service.createSite({
        legalEntityId: 'le-1',
        code: 'MAIN',
        name: 'Wien',
      });

      expect(result.id).toBe('site-1');
      expect(prisma.storageLocation.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ code: 'TRANSIT', is_system: true, type: 'in_transit' }),
            expect.objectContaining({ code: 'LOT', type: 'vehicle_lot' }),
          ]),
        }),
      );
    });

    it('rejects a site under an inactive legal entity', async () => {
      prisma.legalEntity.findFirst.mockResolvedValue({
        id: 'le-1',
        is_active: false,
      });

      await expect(
        service.createSite({ legalEntityId: 'le-1', code: 'W', name: 'Wien' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.site.create).not.toHaveBeenCalled();
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

    it('allows deactivation when the site is clean', async () => {
      prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        legal_entity_id: 'le-1',
        is_active: true,
      });
      prisma.inventoryStock.count.mockResolvedValue(0);
      prisma.vehicle.count.mockResolvedValue(0);
      prisma.site.update.mockResolvedValue({
        id: 'site-1',
        is_active: false,
      });

      const result = await service.updateSite('site-1', { isActive: false });
      expect(result.is_active).toBe(false);
      expect(prisma.inventoryStock.count).toHaveBeenCalled();
      expect(prisma.vehicle.count).toHaveBeenCalled();
    });

    it('blocks deactivation while a parked dealer vehicle is on a site lot', async () => {
      prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        legal_entity_id: 'le-1',
        is_active: true,
      });
      prisma.inventoryStock.count.mockResolvedValue(0);
      prisma.vehicle.count.mockResolvedValue(1);

      await expect(
        service.updateSite('site-1', { isActive: false }),
      ).rejects.toBeInstanceOf(ConflictException);
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
      ).rejects.toBeInstanceOf(ConflictException);
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

    it('rejects an inactive TenantMember', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1' });
      prisma.tenantMember.findFirst.mockResolvedValue({
        id: 'tm-1',
        is_active: false,
      });

      await expect(
        service.addSiteMembership('site-1', { userId: 'u-2' }),
      ).rejects.toBeInstanceOf(ConflictException);
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
