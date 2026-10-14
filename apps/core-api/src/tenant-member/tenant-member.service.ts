import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { getFirebaseAdminAuth } from '../auth/firebase-admin.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { setActiveTenant } from '../common/services/user-active-tenant.js';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  InviteTenantMemberDto,
  ListTenantMembersQueryDto,
  UpdateTenantMemberDto,
} from './dto/tenant-member.dto.js';
import {
  buildTenantClaims,
  isActiveTenantOutOfSync,
  resolveActiveMembership,
} from './tenant-member.claims.js';
import { resolveFirebaseUser } from './tenant-member.firebase.js';
import {
  findInviteUser,
  linkInviteUser,
  normalizeEmail,
} from './tenant-member.invite.js';
import { mapTenantMember } from './tenant-member.mapper.js';
import {
  buildTenantMemberListMeta,
  buildTenantMemberWhere,
  resolveTenantMemberPagination,
} from './tenant-member.queries.js';
import {
  buildMembershipUpdateData,
  isSecuritySensitiveChange,
} from './tenant-member.update.js';

interface MembershipChange {
  securitySensitive: boolean;
  deactivated: boolean;
  wasActiveTenant: boolean;
}

@Injectable()
export class TenantMemberService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly dashboardRealtime: DashboardRealtimeService,
  ) {}

  async findAll(query: ListTenantMembersQueryDto) {
    this.assertTenantAdminAccess();

    const tenantId = this.tenantContext.getRequiredTenantId();
    const { page, limit, skip } = resolveTenantMemberPagination(query);
    const where = buildTenantMemberWhere(tenantId, query);

    const [memberships, total] = await Promise.all([
      this.systemPrisma.tenantMember.findMany({
        where,
        include: { user: true },
        orderBy: [{ createdAt: 'asc' }],
        skip,
        take: limit,
      }),
      this.systemPrisma.tenantMember.count({ where }),
    ]);

    return {
      data: memberships.map((membership) => mapTenantMember(membership)),
      meta: buildTenantMemberListMeta(total, page, limit),
    };
  }

  async invite(dto: InviteTenantMemberDto) {
    this.assertTenantAdminAccess();

    const tenantId = this.tenantContext.getRequiredTenantId();
    const normalizedEmail = normalizeEmail(dto.email);
    const firebaseUser = await resolveFirebaseUser(
      this.getFirebaseAuth(),
      normalizedEmail,
    );
    const resolvedEmail = normalizeEmail(firebaseUser.email ?? normalizedEmail);

    const existingUser = await findInviteUser(
      this.systemPrisma.user,
      firebaseUser.uid,
      resolvedEmail,
    );
    const userId = await linkInviteUser(this.systemPrisma.user, {
      tenantId,
      firebaseUid: firebaseUser.uid,
      email: resolvedEmail,
      existingUser,
    });

    const membership = await this.systemPrisma.tenantMember.upsert({
      where: {
        tenant_id_user_id: {
          tenant_id: tenantId,
          user_id: userId,
        },
      },
      update: {
        role: dto.role,
        is_active: true,
      },
      create: {
        tenant_id: tenantId,
        user_id: userId,
        role: dto.role,
        is_active: true,
      },
      include: { user: true },
    });

    await this.syncUserClaims(userId);
    this.dashboardRealtime.emitClaimsUpdated(firebaseUser.uid);

    return mapTenantMember(membership);
  }

  async update(id: string, dto: UpdateTenantMemberDto) {
    this.assertTenantAdminAccess();

    const tenantId = this.tenantContext.getRequiredTenantId();
    const existingMembership = await this.systemPrisma.tenantMember.findFirst({
      where: {
        id,
        tenant_id: tenantId,
      },
      include: { user: true },
    });

    if (!existingMembership) {
      throw new BadRequestException(`Tenant member ${id} not found.`);
    }

    const updatedMembership = await this.systemPrisma.tenantMember.update({
      where: { id },
      data: buildMembershipUpdateData(dto),
      include: { user: true },
    });

    const securitySensitive = isSecuritySensitiveChange(
      existingMembership.role,
      dto,
    );

    await this.syncUserClaims(updatedMembership.user_id);

    const updatedUser = await this.systemPrisma.user.findFirst({
      where: { id: updatedMembership.user_id },
      select: { firebaseUid: true },
    });

    await this.publishMembershipChange(updatedUser?.firebaseUid, {
      securitySensitive,
      deactivated: dto.isActive === false,
      wasActiveTenant:
        existingMembership.tenant_id ===
        existingMembership.user.active_tenant_id,
    });

    return mapTenantMember(updatedMembership);
  }

  protected getFirebaseAuth() {
    return getFirebaseAdminAuth();
  }

  private async syncUserClaims(userId: string): Promise<void> {
    const user = await this.systemPrisma.user.findFirst({
      where: { id: userId },
      include: {
        platformAdmin: true,
        memberships: {
          where: {
            is_active: true,
            tenant: { is_active: true },
          },
          orderBy: [{ createdAt: 'asc' }],
        },
      },
    });

    if (!user || !user.firebaseUid) {
      throw new BadRequestException(
        `Unable to project claims for user ${userId}.`,
      );
    }

    const activeMembership = resolveActiveMembership(user);

    if (isActiveTenantOutOfSync(user.active_tenant_id, activeMembership)) {
      // Ruling 11: the shared helper atomically nulls active_site_id so the
      // composite FK (active_tenant_id, active_site_id) is never violated.
      await setActiveTenant(
        this.systemPrisma.user,
        user.id,
        activeMembership?.tenant_id ?? null,
      );
    }

    const firebaseAuth = this.getFirebaseAuth();
    const firebaseUser = await firebaseAuth.getUser(user.firebaseUid);
    const nextClaims = buildTenantClaims(
      firebaseUser.customClaims,
      activeMembership,
      user.platformAdmin,
    );

    await firebaseAuth.setCustomUserClaims(user.firebaseUid, nextClaims);
  }

  private async publishMembershipChange(
    firebaseUid: string | null | undefined,
    change: MembershipChange,
  ): Promise<void> {
    if (!firebaseUid) {
      return;
    }

    if (change.securitySensitive) {
      await this.getFirebaseAuth().revokeRefreshTokens(firebaseUid);
    }

    this.dashboardRealtime.emitClaimsUpdated(firebaseUid);

    if (!change.deactivated) {
      return;
    }

    // Ruling 10: `TenantMember.is_active = false` is the same class of event as
    // a site-membership revoke — emit `site:access_scope_updated`. When the
    // deactivated membership was the user's active tenant, syncUserClaims
    // already ran the shared tenant-change helper (nulling `active_site_id` in
    // the same write); emit `site:context_updated` ({ siteId: null }) so every
    // socket leaves the tenant's site room.
    this.dashboardRealtime.emitSiteAccessScopeUpdated(firebaseUid);
    if (change.wasActiveTenant) {
      this.dashboardRealtime.emitSiteContextUpdated(firebaseUid, null);
    }
  }

  private assertTenantAdminAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();

    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }
}
