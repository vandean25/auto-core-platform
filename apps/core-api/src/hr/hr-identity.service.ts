import { ForbiddenException, Injectable } from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedEmployeeMe {
  id: string;
  name: string;
  role: EmployeeRole;
  hired_on: Date | null;
  annual_leave_days: number;
}

@Injectable()
export class HrIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async resolveMe(): Promise<ResolvedEmployeeMe> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.userId) {
      throw new ForbiddenException('No employee record linked to this account');
    }

    const tenantId = await this.tenantContext.getTenantId();

    const employee = await this.prisma.employee.findFirst({
      where: {
        tenant_id: tenantId,
        is_active: true,
        user: {
          OR: [
            ...(user.userId ? [{ firebaseUid: user.userId }] : []),
            ...(user.email ? [{ email: user.email }] : []),
          ],
        },
      },
      select: {
        id: true,
        name: true,
        role: true,
        hired_on: true,
        annual_leave_days: true,
      },
    });

    if (!employee) {
      throw new ForbiddenException('No employee record linked to this account');
    }

    return employee;
  }

  assertOwnerAdmin(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }

  async resolveCreatedByUserId(): Promise<string | null> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.userId && !user?.email) {
      return null;
    }

    const userRecord = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(user.userId ? [{ firebaseUid: user.userId }] : []),
          ...(user.email ? [{ email: user.email }] : []),
        ],
      },
      select: { id: true },
    });

    return userRecord?.id ?? null;
  }
}
