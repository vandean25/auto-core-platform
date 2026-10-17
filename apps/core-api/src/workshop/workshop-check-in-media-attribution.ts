import { UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';

/**
 * WorkshopMedia requires `uploaded_by_employee_id`. Check-in uploads must attribute the
 * active employee linked to the signed-in user.
 */
export async function resolveCheckInMediaUploaderEmployeeId(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
): Promise<string> {
  const authUser = tenantContext.getAuthenticatedUser();
  if (!authUser?.userId) {
    throw new UnprocessableEntityException({
      code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_UPLOADER_REQUIRED,
      message:
        'An active employee record linked to your user is required to upload check-in photos.',
    });
  }

  const user = await prisma.user.findUnique({
    where: { firebaseUid: authUser.userId },
    select: { id: true },
  });
  if (!user) {
    throw new UnprocessableEntityException({
      code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_UPLOADER_REQUIRED,
      message:
        'An active employee record linked to your user is required to upload check-in photos.',
    });
  }

  const linked = await prisma.employee.findFirst({
    where: { tenant_id: tenantId, user_id: user.id, is_active: true },
    select: { id: true },
  });
  if (!linked) {
    throw new UnprocessableEntityException({
      code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_UPLOADER_REQUIRED,
      message:
        'An active employee record linked to your user is required to upload check-in photos.',
    });
  }

  return linked.id;
}
