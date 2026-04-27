import { PlatformAdminRole } from '@prisma/client';
import {
  parseSeedPlatformAdminArgs,
  seedPlatformAdmin,
} from './seed-platform-admin';

describe('parseSeedPlatformAdminArgs', () => {
  it('fails when --email is missing', () => {
    expect(() => parseSeedPlatformAdminArgs([])).toThrow(
      'Missing required --email=<email> argument.',
    );
  });

  it('normalizes the platform admin email', () => {
    expect(
      parseSeedPlatformAdminArgs(['--email=Founder@AutoCore.com']),
    ).toEqual({ email: 'founder@autocore.com' });
  });
});

describe('seedPlatformAdmin', () => {
  it('creates a relational user, promotes it to platform admin, and syncs Firebase claims', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-1' }),
        update: jest.fn(),
      },
      platformAdmin: {
        upsert: jest.fn().mockResolvedValue({
          id: 'platform-admin-1',
          role: PlatformAdminRole.SUPER_ADMIN,
        }),
      },
    };
    const firebaseAuth = {
      getUserByEmail: jest.fn().mockResolvedValue({
        uid: 'firebase-uid-1',
        email: 'Founder@AutoCore.com',
        customClaims: { supportTier: 'gold' },
      }),
      setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
    };

    const result = await seedPlatformAdmin(
      { email: 'founder@autocore.com' },
      { prisma, firebaseAuth },
    );

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { firebaseUid: 'firebase-uid-1' },
          { email: 'founder@autocore.com' },
        ],
      },
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        firebaseUid: 'firebase-uid-1',
        email: 'founder@autocore.com',
      },
    });
    expect(prisma.platformAdmin.upsert).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      update: {
        role: PlatformAdminRole.SUPER_ADMIN,
        is_active: true,
      },
      create: {
        user_id: 'user-1',
        role: PlatformAdminRole.SUPER_ADMIN,
        is_active: true,
      },
    });
    expect(firebaseAuth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      {
        supportTier: 'gold',
        platformRole: PlatformAdminRole.SUPER_ADMIN,
      },
    );
    expect(result).toEqual({
      email: 'founder@autocore.com',
      firebaseUid: 'firebase-uid-1',
      userId: 'user-1',
      platformAdminId: 'platform-admin-1',
    });
  });

  it('updates an existing relational user before reactivating platform admin access', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'user-9' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'user-9' }),
      },
      platformAdmin: {
        upsert: jest.fn().mockResolvedValue({
          id: 'platform-admin-9',
          role: PlatformAdminRole.SUPER_ADMIN,
        }),
      },
    };
    const firebaseAuth = {
      getUserByEmail: jest.fn().mockResolvedValue({
        uid: 'firebase-uid-9',
        email: 'ops@autocore.com',
        customClaims: {},
      }),
      setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
    };

    await seedPlatformAdmin(
      { email: 'ops@autocore.com' },
      { prisma, firebaseAuth },
    );

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-9' },
      data: {
        firebaseUid: 'firebase-uid-9',
        email: 'ops@autocore.com',
      },
    });
  });
});