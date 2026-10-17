import { UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

/**
 * WorkshopMedia still requires `uploaded_by_employee_id`. Prefer the employee linked to
 * the signed-in user; otherwise use the first active employee in the tenant (e2e/advisor
 * without HR linkage).
 */
export async function resolveCheckInMediaUploaderEmployeeId(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
): Promise<string> {
  const authUser = tenantContext.getAuthenticatedUser();
  if (authUser?.userId) {
    const user = await prisma.user.findUnique({
      where: { firebaseUid: authUser.userId },
      select: { id: true },
    });
    if (user) {
      const linked = await prisma.employee.findFirst({
        where: { tenant_id: tenantId, user_id: user.id, is_active: true },
        select: { id: true },
      });
      if (linked) {
        return linked.id;
      }
    }
  }

  const fallback = await prisma.employee.findFirst({
    where: { tenant_id: tenantId, is_active: true },
    orderBy: { sort_order: 'asc' },
    select: { id: true },
  });
  if (!fallback) {
    throw new UnprocessableEntityException(
      'An active employee record is required to attribute check-in media uploads.',
    );
  }
  return fallback.id;
}
