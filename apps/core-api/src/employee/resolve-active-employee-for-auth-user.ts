import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';

type EmployeeLookupClient = Pick<PrismaService, 'employee'>;

export type ResolveActiveEmployeeForAuthUserOptions = {
  role?: Prisma.EmployeeWhereInput['role'];
};

/**
 * Resolves the active employee in a tenant linked to the signed-in user via
 * `User.firebaseUid` or `User.email` (same predicate as mechanic identity).
 */
export async function resolveActiveEmployeeIdForAuthUser(
  prisma: EmployeeLookupClient,
  authUser: Pick<AuthenticatedUser, 'userId' | 'email'> | null | undefined,
  tenantId: string,
  options: ResolveActiveEmployeeForAuthUserOptions = {},
): Promise<string | null> {
  if (!authUser?.userId) {
    return null;
  }

  const employee = await prisma.employee.findFirst({
    where: {
      tenant_id: tenantId,
      is_active: true,
      ...(options.role !== undefined ? { role: options.role } : {}),
      user: {
        OR: [{ firebaseUid: authUser.userId }, { email: authUser.email }],
      },
    },
    select: { id: true },
  });

  return employee?.id ?? null;
}
