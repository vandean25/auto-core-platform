import { ConflictException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { setActiveTenant } from '../common/services/user-active-tenant.js';
import type { SystemPrismaClient } from '../prisma/system-prisma.types.js';

type UserDelegate = SystemPrismaClient['user'];

interface InviteIdentity {
  firebaseUid: string;
  email: string;
}

export interface LinkInviteUserInput extends InviteIdentity {
  tenantId: string;
  existingUser: User | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findInviteUser(
  users: UserDelegate,
  firebaseUid: string,
  email: string,
): Promise<User | null> {
  const boundUser = await users.findFirst({ where: { firebaseUid } });
  if (boundUser) {
    return boundUser;
  }

  const unboundUser = await users.findFirst({
    where: { email, firebaseUid: null },
  });
  if (unboundUser) {
    return unboundUser;
  }

  const conflictingUser = await users.findFirst({ where: { email } });
  if (conflictingUser) {
    throw new ConflictException(
      `User with email ${email} is already bound to another Firebase account.`,
    );
  }

  return null;
}

export async function linkInviteUser(
  users: UserDelegate,
  input: LinkInviteUserInput,
): Promise<string> {
  const { tenantId, firebaseUid, email, existingUser } = input;
  const { userId, hasActiveTenant } = existingUser
    ? await updateInvitedUser(users, existingUser, { firebaseUid, email })
    : await createInvitedUser(users, { firebaseUid, email });

  if (!hasActiveTenant) {
    // Ruling 11: the shared helper atomically nulls active_site_id so the
    // composite FK (active_tenant_id, active_site_id) is never violated.
    await setActiveTenant(users, userId, tenantId);
  }

  return userId;
}

async function updateInvitedUser(
  users: UserDelegate,
  existingUser: User,
  identity: InviteIdentity,
) {
  await users.update({
    where: { id: existingUser.id },
    data: { firebaseUid: identity.firebaseUid, email: identity.email },
  });

  return {
    userId: existingUser.id,
    hasActiveTenant: Boolean(existingUser.active_tenant_id),
  };
}

async function createInvitedUser(
  users: UserDelegate,
  identity: InviteIdentity,
) {
  const createdUser = await users.create({
    data: { firebaseUid: identity.firebaseUid, email: identity.email },
  });

  return {
    userId: createdUser.id,
    hasActiveTenant: Boolean(createdUser.active_tenant_id),
  };
}
