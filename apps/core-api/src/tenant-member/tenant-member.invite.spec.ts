import { ConflictException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { SystemPrismaClient } from '../prisma/system-prisma.types.js';
import {
  findInviteUser,
  linkInviteUser,
  normalizeEmail,
} from './tenant-member.invite.js';

function createUsersDelegate() {
  return {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
}

function asUsersDelegate(
  users: ReturnType<typeof createUsersDelegate>,
): SystemPrismaClient['user'] {
  return users as unknown as SystemPrismaClient['user'];
}

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases the address', () => {
    expect(normalizeEmail('  Tech@AutoCore.com ')).toBe('tech@autocore.com');
  });
});

describe('findInviteUser', () => {
  it('returns the user already bound to the Firebase UID without further lookups', async () => {
    const users = createUsersDelegate();
    const boundUser = {
      id: 'user-1',
      firebaseUid: 'uid-1',
      email: 'tech@autocore.com',
      active_tenant_id: null,
    };
    users.findFirst.mockResolvedValueOnce(boundUser);

    await expect(
      findInviteUser(asUsersDelegate(users), 'uid-1', 'tech@autocore.com'),
    ).resolves.toBe(boundUser);
    expect(users.findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to an unbound user with the same email', async () => {
    const users = createUsersDelegate();
    const unboundUser = {
      id: 'user-2',
      firebaseUid: null,
      email: 'tech@autocore.com',
      active_tenant_id: null,
    };
    users.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(unboundUser);

    await expect(
      findInviteUser(asUsersDelegate(users), 'uid-1', 'tech@autocore.com'),
    ).resolves.toBe(unboundUser);
    expect(users.findFirst).toHaveBeenNthCalledWith(2, {
      where: { email: 'tech@autocore.com', firebaseUid: null },
    });
  });

  it('rejects when the email already belongs to another Firebase account', async () => {
    const users = createUsersDelegate();
    users.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'victim-user',
        firebaseUid: 'uid-other',
        email: 'tech@autocore.com',
        active_tenant_id: null,
      });

    await expect(
      findInviteUser(asUsersDelegate(users), 'uid-1', 'tech@autocore.com'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns null when no user matches the identity', async () => {
    const users = createUsersDelegate();
    users.findFirst.mockResolvedValue(null);

    await expect(
      findInviteUser(asUsersDelegate(users), 'uid-1', 'new@autocore.com'),
    ).resolves.toBeNull();
    expect(users.findFirst).toHaveBeenCalledTimes(3);
  });
});

describe('linkInviteUser', () => {
  it('binds an existing user to the Firebase account and activates the tenant when none is set', async () => {
    const users = createUsersDelegate();
    users.update.mockResolvedValue({});

    await expect(
      linkInviteUser(asUsersDelegate(users), {
        tenantId: 'tenant-a',
        firebaseUid: 'uid-2',
        email: 'tech@autocore.com',
        existingUser: {
          id: 'user-2',
          firebaseUid: null,
          email: 'tech@autocore.com',
          active_tenant_id: null,
        } as User,
      }),
    ).resolves.toBe('user-2');

    expect(users.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'user-2' },
      data: { firebaseUid: 'uid-2', email: 'tech@autocore.com' },
    });
    expect(users.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'user-2' },
      data: { active_tenant_id: 'tenant-a', active_site_id: null },
    });
  });

  it('leaves an existing active tenant untouched', async () => {
    const users = createUsersDelegate();
    users.update.mockResolvedValue({});

    await expect(
      linkInviteUser(asUsersDelegate(users), {
        tenantId: 'tenant-a',
        firebaseUid: 'uid-3',
        email: 'tech@autocore.com',
        existingUser: {
          id: 'user-3',
          firebaseUid: 'uid-3',
          email: 'tech@autocore.com',
          active_tenant_id: 'tenant-b',
        } as User,
      }),
    ).resolves.toBe('user-3');

    expect(users.update).toHaveBeenCalledTimes(1);
  });

  it('creates a user for a new Firebase account and activates the tenant', async () => {
    const users = createUsersDelegate();
    users.create.mockResolvedValue({ id: 'user-4', active_tenant_id: null });
    users.update.mockResolvedValue({});

    await expect(
      linkInviteUser(asUsersDelegate(users), {
        tenantId: 'tenant-a',
        firebaseUid: 'uid-4',
        email: 'new@autocore.com',
        existingUser: null,
      }),
    ).resolves.toBe('user-4');

    expect(users.create).toHaveBeenCalledWith({
      data: { firebaseUid: 'uid-4', email: 'new@autocore.com' },
    });
    expect(users.update).toHaveBeenCalledWith({
      where: { id: 'user-4' },
      data: { active_tenant_id: 'tenant-a', active_site_id: null },
    });
  });
});
