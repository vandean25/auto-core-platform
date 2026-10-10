import type { PrismaService } from '../../prisma/prisma.service.js';

export interface TenantUserContact {
  /** "First Last" from the user record, or null when neither part is set. */
  name: string | null;
  email: string;
}

/**
 * Display contacts for users named in tenant audit fields, such as a proposal's
 * decided_by or an action log's on_behalf_of_user_id. Only users with a
 * membership in the tenant resolve, so an id from another tenant never yields a
 * name or email here. Ids that do not resolve are left out of the map.
 */
export async function loadTenantUserContacts(
  prisma: PrismaService,
  tenantId: string,
  userIds: readonly (string | null | undefined)[],
): Promise<Map<string, TenantUserContact>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const contacts = new Map<string, TenantUserContact>();
  if (ids.length === 0) return contacts;

  const users = await prisma.user.findMany({
    where: {
      id: { in: ids },
      memberships: { some: { tenant_id: tenantId } },
    },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  for (const user of users) {
    contacts.set(user.id, {
      name: formatPersonName(user.firstName, user.lastName),
      email: user.email,
    });
  }
  return contacts;
}

export function formatPersonName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const name = [firstName, lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ');
  return name.length > 0 ? name : null;
}
