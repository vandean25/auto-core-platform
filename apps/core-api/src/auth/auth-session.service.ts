import {
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { PlatformAdminRole, TenantMemberRole } from '@prisma/client';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { setActiveTenant } from '../common/services/user-active-tenant';
import { getFirebaseAdminAuth } from './firebase-admin';
import type {
  AuthenticatedUser,
  PlatformAuthenticatedUser,
  TenantAuthenticatedUser,
} from './types/authenticated-user';

type AuthSessionClaims = {
  sub: string;
  email: string;
};

type UserAccessMembership = {
  tenant_id: string;
  role: TenantMemberRole;
  is_active: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
  };
};

type UserAccessRecord = {
  id: string;
  firebaseUid: string;
  email: string;
  active_tenant_id: string | null;
  platformAdmin: {
    is_active: boolean;
    role: PlatformAdminRole;
  } | null;
  memberships: UserAccessMembership[];
};

export type AuthSessionTenant = {
  id: string;
  name: string;
  slug: string;
};

export type AuthSessionMembership = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: TenantMemberRole;
  isActive: boolean;
};

export type AuthSession = {
  userId: string;
  email: string;
  activeTenant: AuthSessionTenant;
  activeRole: TenantMemberRole;
  memberships: AuthSessionMembership[];
  platformRole?: PlatformAdminRole;
};

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
    @Optional()
    private readonly dashboardRealtime?: DashboardRealtimeService,
  ) {}

  async resolveTenantUser(
    claims: AuthSessionClaims,
  ): Promise<TenantAuthenticatedUser | null> {
    const session = await this.getSessionForClaims(claims);

    if (!session) {
      return null;
    }

    const nextUser: TenantAuthenticatedUser = {
      userId: session.userId,
      email: session.email,
      tenantId: session.activeTenant.id,
      role: session.activeRole,
    };

    if (session.platformRole) {
      nextUser.platformRole = session.platformRole;
    }

    return nextUser;
  }

  async resolvePlatformAdmin(
    claims: AuthSessionClaims,
  ): Promise<PlatformAuthenticatedUser | null> {
    const user = await this.findUserAccessRecordByIdentity(claims);

    if (!user?.platformAdmin?.is_active) {
      return null;
    }

    return {
      userId: user.firebaseUid,
      email: user.email,
      platformRole: user.platformAdmin.role,
    };
  }

  async getSessionForAuthenticatedUser(
    user: AuthenticatedUser,
  ): Promise<AuthSession> {
    const session = await this.getSessionForClaims({
      sub: user.userId,
      email: user.email,
    });

    if (!session) {
      throw new UnauthorizedException(
        'No tenant membership found for authenticated user.',
      );
    }

    return session;
  }

  async getSessionForClaims(
    claims: AuthSessionClaims,
  ): Promise<AuthSession | null> {
    const user = await this.findUserAccessRecordByIdentity(claims);

    if (!user) {
      return null;
    }

    const activeMembership = await this.ensureActiveMembership(user);

    if (!activeMembership) {
      return null;
    }

    return this.buildSession(user, activeMembership);
  }

  async switchTenant(
    user: AuthenticatedUser,
    tenantId: string,
  ): Promise<AuthSession> {
    const userRecord = await this.findUserAccessRecordByIdentity({
      sub: user.userId,
      email: user.email,
    });

    if (!userRecord) {
      throw new UnauthorizedException(
        'No tenant membership found for authenticated user.',
      );
    }

    const requestedMembership = userRecord.memberships.find(
      (membership) => membership.tenant_id === tenantId,
    );

    if (!requestedMembership) {
      throw new ForbiddenException('You do not have access to that tenant.');
    }

    if (
      !requestedMembership.is_active ||
      !requestedMembership.tenant.is_active
    ) {
      throw new ForbiddenException('Requested tenant is inactive.');
    }

    if (userRecord.active_tenant_id !== requestedMembership.tenant_id) {
      // Ruling 11: the shared helper atomically nulls active_site_id so the
      // composite FK (active_tenant_id, active_site_id) is never violated.
      await setActiveTenant(
        this.systemPrisma.user,
        userRecord.id,
        requestedMembership.tenant_id,
      );
      userRecord.active_tenant_id = requestedMembership.tenant_id;
    }

    await this.syncUserClaimsFromRecord(userRecord, requestedMembership);
    this.dashboardRealtime?.emitClaimsUpdated(userRecord.firebaseUid);

    return this.buildSession(userRecord, requestedMembership);
  }

  private async findUserAccessRecordByIdentity(
    claims: AuthSessionClaims,
  ): Promise<UserAccessRecord | null> {
    return this.systemPrisma.user.findFirst({
      where: {
        OR: [{ firebaseUid: claims.sub }, { email: claims.email }],
      },
      select: {
        id: true,
        firebaseUid: true,
        email: true,
        active_tenant_id: true,
        platformAdmin: {
          select: {
            is_active: true,
            role: true,
          },
        },
        memberships: {
          where: {
            is_active: true,
            tenant: {
              is_active: true,
            },
          },
          orderBy: [{ createdAt: 'asc' }],
          select: {
            tenant_id: true,
            role: true,
            is_active: true,
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
                is_active: true,
              },
            },
          },
        },
      },
    });
  }

  private async ensureActiveMembership(
    user: UserAccessRecord,
  ): Promise<UserAccessMembership | null> {
    const activeMembership =
      user.memberships.find(
        (membership) => membership.tenant_id === user.active_tenant_id,
      ) ??
      user.memberships[0] ??
      null;

    if (!activeMembership) {
      return null;
    }

    if ((user.active_tenant_id ?? null) !== activeMembership.tenant_id) {
      await this.systemPrisma.user.update({
        where: { id: user.id },
        data: { active_tenant_id: activeMembership.tenant_id },
      });
      user.active_tenant_id = activeMembership.tenant_id;
    }

    return activeMembership;
  }

  private buildSession(
    user: UserAccessRecord,
    activeMembership: UserAccessMembership,
  ): AuthSession {
    const session: AuthSession = {
      userId: user.firebaseUid,
      email: user.email,
      activeTenant: {
        id: activeMembership.tenant.id,
        name: activeMembership.tenant.name,
        slug: activeMembership.tenant.slug,
      },
      activeRole: activeMembership.role,
      memberships: user.memberships.map((membership) => ({
        tenantId: membership.tenant_id,
        tenantName: membership.tenant.name,
        tenantSlug: membership.tenant.slug,
        role: membership.role,
        isActive: membership.is_active,
      })),
    };

    if (user.platformAdmin?.is_active) {
      session.platformRole = user.platformAdmin.role;
    }

    return session;
  }

  private async syncUserClaimsFromRecord(
    user: UserAccessRecord,
    activeMembership: UserAccessMembership,
  ): Promise<void> {
    const firebaseAuth = getFirebaseAdminAuth();
    const firebaseUser = await firebaseAuth.getUser(user.firebaseUid);
    const nextClaims = {
      ...(firebaseUser.customClaims ?? {}),
    } as Record<string, unknown>;

    delete nextClaims.tenantId;
    delete nextClaims.role;
    delete nextClaims.platformRole;

    nextClaims.tenantId = activeMembership.tenant_id;
    nextClaims.role = activeMembership.role;

    if (user.platformAdmin?.is_active) {
      nextClaims.platformRole = user.platformAdmin.role;
    }

    await firebaseAuth.setCustomUserClaims(user.firebaseUid, nextClaims);
  }
}
