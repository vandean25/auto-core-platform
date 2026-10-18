import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CallerAccess } from './stock-transfer-access.types.js';
import { TENANT_ADMIN_ROLES } from './stock-transfer.constants.js';

@Injectable()
export class StockTransferAccessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
  ) {}

  async loadCallerAccess(): Promise<CallerAccess> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    if (!authUser?.userId) {
      throw new ForbiddenException(
        'Stock transfers require an authenticated user.',
      );
    }
    const tenantId = await this.tenantContext.getTenantId();
    const user = await this.prisma.user.findFirst({
      where: { firebaseUid: authUser.userId },
      select: { id: true },
    });
    if (!user) {
      throw new ForbiddenException('User not found for the current session.');
    }

    const memberships = await this.prisma.siteMembership.findMany({
      where: {
        tenant_id: tenantId,
        user_id: user.id,
        is_active: true,
        site: { is_active: true },
        tenantMember: { is_active: true },
      },
      select: { site_id: true, tenantMember: { select: { role: true } } },
    });

    const accessBySite = new Map<string, string>();
    for (const membership of memberships) {
      accessBySite.set(membership.site_id, membership.tenantMember.role);
    }
    const isAdmin = memberships.some((membership) =>
      (TENANT_ADMIN_ROLES as readonly string[]).includes(
        membership.tenantMember.role,
      ),
    );
    return { userId: user.id, tenantId, accessBySite, isAdmin };
  }

  assertTransferAccess(
    access: CallerAccess,
    transfer: { from_site_id: string; to_site_id: string } | null,
    options: {
      requireFrom?: boolean;
      requireTo?: boolean;
      requireAdmin?: boolean;
      allowFromAdmin?: boolean;
    },
  ): { fromAccess: boolean; toAccess: boolean } {
    if (!transfer) {
      throw new NotFoundException('Stock transfer not found');
    }
    const fromAccess = access.accessBySite.has(transfer.from_site_id);
    const toAccess = access.accessBySite.has(transfer.to_site_id);
    if (!fromAccess && !toAccess) {
      throw new NotFoundException('Stock transfer not found');
    }
    if (options.requireFrom && !fromAccess) {
      throw new ForbiddenException(
        'This action requires an active membership on the from-site.',
      );
    }
    if (options.requireTo && !toAccess) {
      if (options.allowFromAdmin && fromAccess && access.isAdmin) {
        return { fromAccess, toAccess };
      }
      throw new ForbiddenException(
        'This action requires an active membership on the to-site.',
      );
    }
    if (options.requireAdmin && !(fromAccess && access.isAdmin)) {
      throw new ForbiddenException(
        'This action requires OWNER/ADMIN on the from-site.',
      );
    }
    return { fromAccess, toAccess };
  }
}
