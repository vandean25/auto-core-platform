import { UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { resolveActiveEmployeeIdForAuthUser } from '../employee/resolve-active-employee-for-auth-user.js';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';

export const CHECK_IN_MEDIA_UPLOADER_REQUIRED_MESSAGE =
  'Your user account is not linked to an active employee in this workshop. Ask an administrator to link it.';

/**
 * WorkshopMedia requires `uploaded_by_employee_id`. Check-in uploads must attribute the
 * active employee linked to the signed-in user.
 */
export async function resolveCheckInMediaUploaderEmployeeId(
  prisma: Pick<PrismaService, 'employee'>,
  tenantContext: TenantContextService,
  tenantId: string,
): Promise<string> {
  const authUser = tenantContext.getAuthenticatedUser();
  const employeeId = await resolveActiveEmployeeIdForAuthUser(
    prisma,
    authUser,
    tenantId,
  );
  if (!employeeId) {
    throw new UnprocessableEntityException({
      code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_UPLOADER_REQUIRED,
      message: CHECK_IN_MEDIA_UPLOADER_REQUIRED_MESSAGE,
    });
  }

  return employeeId;
}
