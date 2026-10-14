import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SiteContextService } from '../site/site-context.service.js';

export function assertCanReadSchedules(role: string | undefined): void {
  if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'SALES') {
    throw new ForbiddenException(
      'Schedule access is restricted to managers and SALES.',
    );
  }
}

export async function assertScheduleEmployeeExists(
  prisma: PrismaService,
  employeeId: string,
  tenantId: string,
): Promise<void> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenant_id: tenantId },
    select: { id: true },
  });
  if (!employee) {
    throw new NotFoundException(`Employee ${employeeId} not found`);
  }
}

export async function assertAuthorizedScheduleSite(
  siteContext: SiteContextService,
  siteId: string,
): Promise<void> {
  const authorizedSiteIds = await siteContext.listAuthorizedSiteIds();
  if (!authorizedSiteIds.includes(siteId)) {
    throw new UnprocessableEntityException(
      'Active site membership required on target site',
    );
  }
}
