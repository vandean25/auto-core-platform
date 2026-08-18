import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MechanicIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async resolveMechanic(): Promise<string> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || user.role !== 'TECH') {
      throw new ForbiddenException(
        'Only technicians (TECH role) may access mechanic endpoints.',
      );
    }

    const tenantId = await this.tenantContext.getTenantId();

    const employee = await this.prisma.employee.findFirst({
      where: {
        tenant_id: tenantId,
        role: 'MECHANIC',
        is_active: true,
        user: {
          OR: [{ firebaseUid: user.userId }, { email: user.email }],
        },
      },
      select: { id: true },
    });

    if (!employee) {
      throw new NotFoundException(
        'Active mechanic employee for the authenticated user was not found in this tenant.',
      );
    }

    return employee.id;
  }

  /**
   * Resolves and validates the current authenticated user as a MECHANIC
   * employee for the given tenant.
   *
   * Throws ForbiddenException if the user is not a TECH tenant member.
   * Throws NotFoundException if no active MECHANIC employee exists for the
   * given mechanicId within the tenant.
   */
  async assertMechanicAccess(mechanicId: string): Promise<void> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || user.role !== 'TECH') {
      throw new ForbiddenException(
        'Only technicians (TECH role) may access mechanic endpoints.',
      );
    }

    const tenantId = await this.tenantContext.getTenantId();

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: mechanicId,
        tenant_id: tenantId,
        role: 'MECHANIC',
        is_active: true,
      },
      select: { id: true },
    });

    if (!employee) {
      throw new NotFoundException(
        `Active mechanic employee ${mechanicId} not found in this tenant.`,
      );
    }
  }
}
