import { seedDemoUsers } from './demo-users.fixture.js';

function createDemoFoundation(): any {
  return {
    defaultTenant: { id: 'tenant-1' },
    mainSite: { id: 'site-main', code: 'MAIN' },
    grzSite: { id: 'site-grz', code: 'GRZ' },
  };
}

// Mirrors the seed-relevant employee/user semantics of Prisma, including the
// (tenant_id, user_id) unique constraint, so the fixture's create-vs-update
// idempotency logic is what the tests exercise.
function createSeedStatePrisma(): {
  prisma: any;
  users: any[];
  employees: any[];
} {
  const users: any[] = [];
  const employees: any[] = [];
  let nextId = 0;
  const nextRowId = (prefix: string) => `${prefix}-${++nextId}`;

  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: any) => {
        const found =
          'firebaseUid' in where
            ? users.find((u) => u.firebaseUid === where.firebaseUid)
            : users.find((u) => u.email === where.email);
        return Promise.resolve(found ?? null);
      }),
      create: jest.fn(({ data }: any) => {
        const row = { id: nextRowId('user'), ...data };
        users.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = users.find((u) => u.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    platformAdmin: { upsert: jest.fn().mockResolvedValue({}) },
    tenantMember: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    tenant: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    siteMembership: { upsert: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((work: (tx: typeof prisma) => unknown) =>
      work(prisma),
    ),
    employee: {
      findFirst: jest.fn(({ where }: any) => {
        const found = employees.find(
          (e) => e.tenant_id === where.tenant_id && e.name === where.name,
        );
        return Promise.resolve(found ?? null);
      }),
      create: jest.fn(({ data }: any) => {
        if (
          employees.some(
            (e) =>
              e.tenant_id === data.tenant_id && e.user_id === data.user_id,
          )
        ) {
          throw new Error(
            'Unique constraint failed on employees (tenant_id, user_id)',
          );
        }
        const row = { id: nextRowId('employee'), ...data };
        employees.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = employees.find((e) => e.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
  };

  return { prisma, users, employees };
}

describe('seedDemoUsers', () => {
  function createMockPrisma(): any {
    const mock: any = {
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      siteMembership: {
        upsert: jest.fn().mockResolvedValue({ id: 'sm-1' }),
      },
      employee: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'emp-1' }),
        update: jest.fn().mockResolvedValue({ id: 'emp-1' }),
      },
      $transaction: jest.fn((work: (tx: typeof mock) => unknown) => work(mock)),
    };
    return mock;
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

  // Catches the AUT-725 regression: the admin demo user had no linked
  // employee after a re-seed, so check-in completion failed with
  // 422 CHECK_IN_MEDIA_UPLOADER_REQUIRED.
  it.each([
    {
      email: 'grok-bot@auto.core.at',
      employeeName: 'Grok Bot QA',
      role: 'SERVICE_ADVISOR',
    },
    {
      email: 'grok-bot-tech@auto.core.at',
      employeeName: 'Grok Bot',
      role: 'MECHANIC',
    },
  ])(
    'seeds exactly one active $role employee $employeeName linked to $email in the demo tenant',
    async ({ email, employeeName, role }) => {
      const { prisma, users, employees } = createSeedStatePrisma();

      await seedDemoUsers(prisma, createDemoFoundation());

      const userIds = users
        .filter((u) => u.email === email)
        .map((u) => u.id);
      expect(userIds).toHaveLength(1);

      const linked = employees.filter((e) => userIds.includes(e.user_id));
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({
        name: employeeName,
        role,
        is_active: true,
        tenant_id: 'tenant-1',
      });
    },
  );

  it('re-running the seed keeps exactly one linked employee per demo user', async () => {
    const { prisma, users, employees } = createSeedStatePrisma();
    const foundation = createDemoFoundation();

    await seedDemoUsers(prisma, foundation);
    await seedDemoUsers(prisma, foundation);

    expect(employees).toHaveLength(2);
    for (const email of [
      'grok-bot@auto.core.at',
      'grok-bot-tech@auto.core.at',
    ]) {
      const userId = users.find((u) => u.email === email)!.id;
      expect(employees.filter((e) => e.user_id === userId)).toHaveLength(1);
    }
  });
});
