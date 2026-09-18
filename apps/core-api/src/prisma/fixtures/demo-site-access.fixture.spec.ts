import { seedDemoSiteAccess } from './demo-site-access.fixture.js';

describe('seedDemoSiteAccess', () => {
  it('creates site memberships for active tenant members on all demo sites', async () => {
    const foundation = {
      defaultTenant: { id: 'tenant-1' },
      mainSite: { id: 'site-main' },
      grzSite: { id: 'site-grz' },
    } as any;

    const mockPrisma: any = {
      tenantMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            user_id: 'user-1',
            user: {
              id: 'user-1',
              email: 'admin@example.com',
              active_tenant_id: 'tenant-1',
              active_site_id: null,
            },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      siteMembership: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'sm-1' }),
      },
    };

    await seedDemoSiteAccess(mockPrisma, foundation);

    expect(mockPrisma.siteMembership.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { active_site_id: 'site-main' },
    });
  });
});
