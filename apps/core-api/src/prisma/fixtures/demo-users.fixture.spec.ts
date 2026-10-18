import { seedDemoUsers } from './demo-users.fixture.js';

describe('seedDemoUsers', () => {
  function createMockPrisma(): any {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: `user-${data.email}`, ...data })
        ),
        update: jest.fn().mockImplementation(({ where, data }) =>
          Promise.resolve({ id: where.id, ...data })
        ),
      },
      platformAdmin: {
        upsert: jest.fn().mockResolvedValue({ id: 'pa-1', role: 'SUPER_ADMIN' }),
      },
      tenantMember: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({ id: `tm-${create.user_id}`, ...create })
        ),
      },
      siteMembership: {
        upsert: jest.fn().mockResolvedValue({ id: 'sm-1' }),
      },
      employee: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'emp-1' }),
        update: jest.fn().mockResolvedValue({ id: 'emp-1' }),
      },
    };
  }

  it('seeds bootstrap admin email with SUPER_ADMIN, OWNER, and both demo site memberships when provided', async () => {
    const foundation = {
      defaultTenant: { id: 'tenant-1' },
      mainSite: { id: 'site-main', code: 'MAIN' },
      grzSite: { id: 'site-grz', code: 'GRZ' },
    } as any;

    const mockPrisma = createMockPrisma();

    const mockFirebaseAuth: any = {
      setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
    };

    await seedDemoUsers(mockPrisma, foundation, {
      bootstrapAdminEmail: 'bootstrap-owner@example.com',
      bootstrapAdminUid: 'uid-bootstrap-owner',
      firebaseAuth: mockFirebaseAuth,
    });

    // Verify bootstrap admin user creation
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'bootstrap-owner@example.com',
          firebaseUid: 'uid-bootstrap-owner',
          active_tenant_id: 'tenant-1',
          active_site_id: 'site-main',
        }),
      })
    );

    // Verify platform admin SUPER_ADMIN
    expect(mockPrisma.platformAdmin.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'user-bootstrap-owner@example.com' },
        create: expect.objectContaining({
          user_id: 'user-bootstrap-owner@example.com',
          role: 'SUPER_ADMIN',
          is_active: true,
        }),
        update: expect.objectContaining({
          role: 'SUPER_ADMIN',
          is_active: true,
        }),
      })
    );

    // Verify tenant member OWNER
    expect(mockPrisma.tenantMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_user_id: {
            tenant_id: 'tenant-1',
            user_id: 'user-bootstrap-owner@example.com',
          },
        },
        create: expect.objectContaining({
          tenant_id: 'tenant-1',
          user_id: 'user-bootstrap-owner@example.com',
          role: 'OWNER',
          is_active: true,
        }),
        update: expect.objectContaining({
          role: 'OWNER',
          is_active: true,
        }),
      })
    );

    // Verify site memberships on MAIN and GRZ
    expect(mockPrisma.siteMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_user_id_site_id: {
            tenant_id: 'tenant-1',
            user_id: 'user-bootstrap-owner@example.com',
            site_id: 'site-main',
          },
        },
        create: expect.objectContaining({
          tenant_id: 'tenant-1',
          site_id: 'site-main',
          user_id: 'user-bootstrap-owner@example.com',
          is_active: true,
        }),
        update: expect.objectContaining({
          is_active: true,
        }),
      })
    );
    expect(mockPrisma.siteMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_user_id_site_id: {
            tenant_id: 'tenant-1',
            user_id: 'user-bootstrap-owner@example.com',
            site_id: 'site-grz',
          },
        },
        create: expect.objectContaining({
          tenant_id: 'tenant-1',
          site_id: 'site-grz',
          user_id: 'user-bootstrap-owner@example.com',
          is_active: true,
        }),
        update: expect.objectContaining({
          is_active: true,
        }),
      })
    );

    // Verify Firebase claims synced
    expect(mockFirebaseAuth.setCustomUserClaims).toHaveBeenCalledWith(
      'uid-bootstrap-owner',
      expect.objectContaining({
        tenantId: 'tenant-1',
        role: 'OWNER',
        platformRole: 'SUPER_ADMIN',
      })
    );
  });

  it('seeds standard synthetic demo users without bootstrap email when not provided', async () => {
    const foundation = {
      defaultTenant: { id: 'tenant-1' },
      mainSite: { id: 'site-main', code: 'MAIN' },
      grzSite: { id: 'site-grz', code: 'GRZ' },
    } as any;

    const mockPrisma = createMockPrisma();

    await seedDemoUsers(mockPrisma, foundation);

    // Verify synthetic testauto user is created
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'testauto@auto.core.at',
        }),
      })
    );

    // Verify only DEMO_USERS were created (no bootstrap admin)
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(5);
  });

  it('updates an existing user instead of creating when found by email', async () => {
    const foundation = {
      defaultTenant: { id: 'tenant-1' },
      mainSite: { id: 'site-main', code: 'MAIN' },
      grzSite: { id: 'site-grz', code: 'GRZ' },
    } as any;

    const existingUser = {
      id: 'existing-user-id',
      email: 'testauto@auto.core.at',
      firebaseUid: 'e39adbd4-1c55-4044-a4b7-7fd492c2cdbe',
      active_tenant_id: 'tenant-1',
      active_site_id: 'site-main',
    };

    const mockPrisma = createMockPrisma();
    // First user lookup by firebaseUid returns existing user
    mockPrisma.user.findUnique.mockResolvedValueOnce(existingUser);

    await seedDemoUsers(mockPrisma, foundation);

    // Verify update was called for the existing user
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-user-id' },
        data: expect.objectContaining({
          email: 'testauto@auto.core.at',
          firebaseUid: 'e39adbd4-1c55-4044-a4b7-7fd492c2cdbe',
          active_tenant_id: 'tenant-1',
        }),
      })
    );

    // The remaining demo users should be created (not found)
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(4);
  });
});
