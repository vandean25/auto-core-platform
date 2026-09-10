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
import { SiteMembershipService } from './site-membership.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const adminUser = {
  userId: 'fb-admin',
  email: 'admin@example.com',
  tenantId: TENANT_ID,
  role: 'ADMIN',
};

const nonAdminUser = {
  userId: 'fb-member',
  email: 'member@example.com',
  tenantId: TENANT_ID,
  role: 'MEMBER',
};

function createPrismaMock() {
  const mock = {
    site: {
      findFirst: jest.fn(),
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
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback(mock),
  );
  return mock;
}

describe('SiteMembershipService', () => {
  let service: SiteMembershipService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let tenantContext: {
    getTenantId: jest.Mock;
    getAuthenticatedUser: jest.Mock;
  };

  beforeEach(async () => {
    prisma = createPrismaMock();
    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
      getAuthenticatedUser: jest.fn().mockReturnValue(adminUser),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SiteMembershipService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get(SiteMembershipService);
  });

  describe('listSiteMemberships', () => {
    it('requires tenant admin', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue(nonAdminUser);
      await expect(service.listSiteMemberships('site-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('requires site to exist in tenant', async () => {
      prisma.site.findFirst.mockResolvedValue(null);
      await expect(service.listSiteMemberships('site-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns memberships when valid', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1', tenant_id: TENANT_ID });
      prisma.siteMembership.findMany.mockResolvedValue([{ id: 'sm-1' }]);

      const result = await service.listSiteMemberships('site-1');
      expect(result).toEqual([{ id: 'sm-1' }]);
      expect(prisma.siteMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: TENANT_ID, site_id: 'site-1' },
        }),
      );
    });
  });

  describe('addSiteMembership', () => {
    it('rejects a user with no TenantMember in tenant', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1', tenant_id: TENANT_ID });
      prisma.tenantMember.findFirst.mockResolvedValue(null);

      await expect(
        service.addSiteMembership('site-1', { userId: 'user-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an inactive TenantMember', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1', tenant_id: TENANT_ID });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1', is_active: false });

      await expect(
        service.addSiteMembership('site-1', { userId: 'user-1' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects duplicate site membership', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1', tenant_id: TENANT_ID });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1', is_active: true });
      prisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-1' });

      await expect(
        service.addSiteMembership('site-1', { userId: 'user-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates membership when eligible', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1', tenant_id: TENANT_ID });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1', is_active: true });
      prisma.siteMembership.findFirst.mockResolvedValue(null);
      prisma.siteMembership.create.mockResolvedValue({ id: 'sm-new' });

      const result = await service.addSiteMembership('site-1', { userId: 'user-1' });
      expect(result).toEqual({ id: 'sm-new' });
      expect(prisma.siteMembership.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          user_id: 'user-1',
          site_id: 'site-1',
          is_active: true,
        },
      });
    });
  });

  describe('removeSiteMembership', () => {
    it('throws NotFoundException if membership does not exist', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1', tenant_id: TENANT_ID });
      prisma.siteMembership.findFirst.mockResolvedValue(null);

      await expect(
        service.removeSiteMembership('site-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes membership and clears active_site_id', async () => {
      prisma.site.findFirst.mockResolvedValue({ id: 'site-1', tenant_id: TENANT_ID });
      prisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-1' });

      const result = await service.removeSiteMembership('site-1', 'user-1');
      expect(result).toEqual({ deleted: true });
      expect(prisma.siteMembership.delete).toHaveBeenCalledWith({
        where: { id: 'sm-1' },
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { active_site_id: 'site-1', id: 'user-1' },
        data: { active_site_id: null },
      });
    });
  });
});
