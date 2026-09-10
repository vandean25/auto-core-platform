import { Test, TestingModule } from '@nestjs/testing';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { SiteContextService } from './site-context.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const FIREBASE_UID = 'firebase-user-1';
const ACTIVE_SITE_ID = '00000000-0000-0000-0000-000000000003';

function createPrismaMock() {
  return {
    user: {
      findFirst: jest.fn(),
    },
    site: {
      findFirst: jest.fn(),
    },
    tenantMember: {
      findFirst: jest.fn(),
    },
    siteMembership: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('SiteContextService', () => {
  let service: SiteContextService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let tenantContext: {
    getAuthenticatedUser: jest.Mock;
    getRequiredTenantId: jest.Mock;
  };

  const authUser = {
    userId: FIREBASE_UID,
    email: 'user@example.com',
    tenantId: TENANT_ID,
    role: 'ADMIN',
  };

  beforeEach(async () => {
    prisma = createPrismaMock();
    tenantContext = {
      getAuthenticatedUser: jest.fn().mockReturnValue(authUser),
      getRequiredTenantId: jest.fn().mockReturnValue(TENANT_ID),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SiteContextService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get(SiteContextService);
  });

  const happyPath = () => {
    prisma.user.findFirst.mockResolvedValue({
      id: USER_ID,
      active_tenant_id: TENANT_ID,
      active_site_id: ACTIVE_SITE_ID,
    });
    prisma.site.findFirst.mockResolvedValue({
      id: ACTIVE_SITE_ID,
      tenant_id: TENANT_ID,
      is_active: true,
      code: 'MAIN',
      name: 'Main Site',
    });
    prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
    prisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-1' });
  };

  describe('getSiteId', () => {
    it('returns the validated active site id', async () => {
      happyPath();
      await expect(service.getSiteId()).resolves.toBe(ACTIVE_SITE_ID);
      expect(prisma.site.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: ACTIVE_SITE_ID,
            is_active: true,
          }),
        }),
      );
    });

    it('throws 422 ACTIVE_SITE_REQUIRED when the user has no active site', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: USER_ID,
        active_tenant_id: TENANT_ID,
        active_site_id: null,
      });

      await expect(service.getSiteId()).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({ code: 'ACTIVE_SITE_REQUIRED' }),
      });
    });

    it('throws when the site belongs to another tenant (active_tenant mismatch)', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: USER_ID,
        active_tenant_id: 'other-tenant',
        active_site_id: ACTIVE_SITE_ID,
      });

      await expect(service.getSiteId()).rejects.toMatchObject({
        status: 422,
      });
    });

    it('throws when the site is inactive', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: USER_ID,
        active_tenant_id: TENANT_ID,
        active_site_id: ACTIVE_SITE_ID,
      });
      prisma.site.findFirst.mockResolvedValue(null);

      await expect(service.getSiteId()).rejects.toMatchObject({
        status: 422,
      });
    });

    it('throws when the TenantMember is inactive or missing', async () => {
      happyPath();
      prisma.tenantMember.findFirst.mockResolvedValue(null);

      await expect(service.getSiteId()).rejects.toMatchObject({
        status: 422,
      });
    });

    it('throws when the SiteMembership is inactive or missing', async () => {
      happyPath();
      prisma.siteMembership.findFirst.mockResolvedValue(null);

      await expect(service.getSiteId()).rejects.toMatchObject({
        status: 422,
      });
    });

    it('returns null from tryGetSite instead of throwing', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: USER_ID,
        active_tenant_id: TENANT_ID,
        active_site_id: null,
      });

      await expect(service.tryGetSite()).resolves.toBeNull();
    });

    it('resolveSiteId returns null instead of throwing', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.resolveSiteId()).resolves.toBeNull();
    });
  });

  describe('listAuthorizedSiteIds (ruling 12)', () => {
    it('returns distinct site ids from active memberships joined to an active tenant member', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: USER_ID });
      prisma.siteMembership.findMany.mockResolvedValue([
        { site_id: 'site-a' },
        { site_id: 'site-b' },
        { site_id: 'site-a' },
      ]);

      await expect(service.listAuthorizedSiteIds()).resolves.toEqual([
        'site-a',
        'site-b',
      ]);

      expect(prisma.siteMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: TENANT_ID,
            user_id: USER_ID,
            is_active: true,
            site: { is_active: true },
            tenantMember: { is_active: true },
          }),
        }),
      );
    });

    it('returns an empty list when the user row is missing', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.listAuthorizedSiteIds()).resolves.toEqual([]);
    });
  });
});
