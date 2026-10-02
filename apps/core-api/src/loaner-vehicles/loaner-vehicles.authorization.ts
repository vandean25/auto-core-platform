import { ForbiddenException, Injectable } from '@nestjs/common';
import { EmployeeRole, TenantMemberRole } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { loanerForbiddenWriteException } from './loaner.errors.js';

@Injectable()
export class LoanerVehiclesAuthorization {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async assertWriteAccess(): Promise<void> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.tenantId) {
      throw loanerForbiddenWriteException();
    }

    if (
      user.role === TenantMemberRole.OWNER ||
      user.role === TenantMemberRole.ADMIN
    ) {
      return;
    }

    const dbUser = await this.prisma.user.findFirst({
      where: {
        firebaseUid: user.userId,
        active_tenant_id: user.tenantId,
      },
      select: { id: true },
    });

    if (!dbUser) {
      throw loanerForbiddenWriteException();
    }

    const advisor = await this.prisma.employee.findFirst({
      where: {
        tenant_id: user.tenantId,
        user_id: dbUser.id,
        role: EmployeeRole.SERVICE_ADVISOR,
        is_active: true,
      },
      select: { id: true },
    });

    if (!advisor) {
      throw loanerForbiddenWriteException();
    }
  }

  assertReadAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.tenantId && !user?.platformRole) {
      throw new ForbiddenException('Authentication required.');
    }
  }
}
