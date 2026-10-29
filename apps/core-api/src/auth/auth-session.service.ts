import {
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { PlatformAdminRole, TenantMemberRole } from '@prisma/client';
import type { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { DASHBOARD_REALTIME_SERVICE_TOKEN } from '../dashboard-realtime/dashboard-realtime.tokens.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { setActiveTenant } from '../common/services/user-active-tenant.js';
import { getFirebaseAdminAuth } from './firebase-admin.js';
import { LandingDemoSignInGrantService } from '../landing-demo-access/landing-demo-sign-in-grant.service.js';
import type {
  AuthenticatedUser,
  PlatformAuthenticatedUser,
  TenantAuthenticatedUser,
} from './types/authenticated-user.js';
import { DisplayLanguage } from '@prisma/client';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  DEFAULT_FORMAT_LOCALE,
} from '../common/i18n/display-language.js';
import { resolveUserLanguage } from '../common/i18n/locale-resolution.js';
import { isMembershipCurrentlyValid } from './membership-validity.js';
import {
  resolveCountryPack,
  type CountryCapabilities,
} from '../common/country-pack/country-pack.registry.js';

type AuthSessionClaims = {
  sub: string;
  email: string;
  emailVerified?: boolean;
};

type UserAccessMembership = {
  tenant_id: string;
  role: TenantMemberRole;
  is_active: boolean;
  demo_access_expires_at: Date | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    default_locale: DisplayLanguage;
    format_locale: string;
  };
};

type UserAccessRecord = {
  id: string;
  firebaseUid: string;
  email: string;
  locale: DisplayLanguage | null;
  active_tenant_id: string | null;
  active_site_id: string | null;
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
  activeSiteId: string | null;
  memberships: AuthSessionMembership[];
  platformRole?: PlatformAdminRole;
  locale: DisplayLanguage | null;
  effectiveLocale: DisplayLanguage;
  defaultLocale: DisplayLanguage;
  formatLocale: string;
  effectiveCapabilities: CountryCapabilities | null;
};

const USER_ACCESS_SELECT = {
  id: true,
  firebaseUid: true,
  email: true,
  locale: true,
  active_tenant_id: true,
  active_site_id: true,
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
    orderBy: [{ createdAt: 'asc' as const }],
    select: {
      tenant_id: true,
      role: true,
      is_active: true,
      demo_access_expires_at: true,
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          is_active: true,
          default_locale: true,
          format_locale: true,
        },
      },
    },
  },
};

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly landingDemoGrants: LandingDemoSignInGrantService,
    @Optional()
    @Inject(DASHBOARD_REALTIME_SERVICE_TOKEN)
    private readonly dashboardRealtime?: DashboardRealtimeService,
  ) {}

  async resolveTenantUser(
    claims: AuthSessionClaims,
  ): Promise<TenantAuthenticatedUser | null> {
    const resolvedSession = await this.resolveSessionForClaims(claims);

    if (!resolvedSession) {
      return null;
    }

    const { session, user } = resolvedSession;
    const nextUser: TenantAuthenticatedUser = {
      userId: session.userId,
      email: session.email,
      tenantId: session.activeTenant.id,
      role: session.activeRole,
      activeSiteId: user.active_site_id,
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
      emailVerified: true,
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
    const resolvedSession = await this.resolveSessionForClaims(claims);
    if (!resolvedSession) {
      return null;
    }
    return this.withEffectiveCapabilities(
      resolvedSession.session,
      resolvedSession.user.id,
    );
  }

  private async withEffectiveCapabilities(
    session: AuthSession,
    userId: string,
  ): Promise<AuthSession> {
    if (!session.activeSiteId) {
      return session;
    }
    const tenantId = session.activeTenant.id;
    const membership = await this.systemPrisma.siteMembership.findFirst({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        site_id: session.activeSiteId,
        is_active: true,
        tenantMember: { tenant_id: tenantId, is_active: true },
        site: {
          tenant_id: tenantId,
          id: session.activeSiteId,
          is_active: true,
          legal_entity: { tenant_id: tenantId, is_active: true },
        },
      },
      select: {
        site: { select: { legal_entity: { select: { country_iso: true } } } },
      },
    });
    return {
      ...session,
      effectiveCapabilities: membership
        ? resolveCountryPack(membership.site.legal_entity.country_iso)
            .capabilities
        : null,
    };
  }

  private async resolveSessionForClaims(
    claims: AuthSessionClaims,
  ): Promise<{ session: AuthSession; user: UserAccessRecord } | null> {
    const user = await this.findUserAccessRecordByIdentity(claims);

    if (!user) {
      return null;
    }

    user.memberships = user.memberships.filter((membership) =>
      isMembershipCurrentlyValid(membership),
    );

    const activeMembership = await this.ensureActiveMembership(user);

    if (!activeMembership) {
      return null;
    }

    if (activeMembership.role === TenantMemberRole.DEMO) {
      await this.landingDemoGrants.assertDemoSignInGrantForSession(user.id);
    }

    return {
      session: this.buildSession(user, activeMembership),
      user,
    };
  }

  async switchTenant(
    user: AuthenticatedUser,
    tenantId: string,
  ): Promise<AuthSession> {
    const userRecord = await this.findUserAccessRecordByIdentity({
      sub: user.userId,
      email: user.email,
      emailVerified: true,
    });

    if (!userRecord) {
      throw new UnauthorizedException(
        'No tenant membership found for authenticated user.',
      );
    }

    const validMemberships = userRecord.memberships.filter((membership) =>
      isMembershipCurrentlyValid(membership),
    );

    const requestedMembership = validMemberships.find(
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

    const demoOnlyUser = validMemberships.every(
      (membership) => membership.role === TenantMemberRole.DEMO,
    );
    if (demoOnlyUser && requestedMembership.role !== TenantMemberRole.DEMO) {
      throw new ForbiddenException(
        'Demo accounts may only access the demo tenant.',
      );
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
      userRecord.active_site_id = null;
      // Ruling 9/11: every socket for this user leaves the previous tenant's
      // site room (siteId: null). auth:claims_updated is emitted below.
      this.dashboardRealtime?.emitSiteContextUpdated(
        userRecord.firebaseUid,
        null,
      );
    }

    await this.syncUserClaimsFromRecord(userRecord, requestedMembership);
    this.dashboardRealtime?.emitClaimsUpdated(userRecord.firebaseUid);

    return this.withEffectiveCapabilities(
      this.buildSession(userRecord, requestedMembership),
      userRecord.id,
    );
  }

  private async findUserAccessRecordByIdentity(
    claims: AuthSessionClaims,
  ): Promise<UserAccessRecord | null> {
    const byUid = await this.systemPrisma.user.findFirst({
      where: { firebaseUid: claims.sub },
      select: USER_ACCESS_SELECT,
    });

    if (byUid) {
      if (!byUid.firebaseUid) {
        return null;
      }
      return byUid as UserAccessRecord;
    }

    // Email fallback only for verified emails, and only to *link* an
    // un-bound row; never match a row already bound to a different uid.
    if (!claims.emailVerified) {
      return null;
    }

    const byEmail = await this.systemPrisma.user.findFirst({
      where: {
        email: claims.email,
        firebaseUid: null,
      },
      select: USER_ACCESS_SELECT,
    });

    if (!byEmail) {
      return null;
    }

    await this.systemPrisma.user.update({
      where: { id: byEmail.id },
      data: { firebaseUid: claims.sub },
    });

    return {
      ...byEmail,
      firebaseUid: claims.sub,
    };
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
      // Ruling 11: the shared helper atomically nulls active_site_id so the
      // composite FK (active_tenant_id, active_site_id) is never violated.
      await setActiveTenant(
        this.systemPrisma.user,
        user.id,
        activeMembership.tenant_id,
      );
      user.active_tenant_id = activeMembership.tenant_id;
      user.active_site_id = null;
      // Ruling 9/11: second tabs learn the session site was cleared.
      this.dashboardRealtime?.emitSiteContextUpdated(user.firebaseUid, null);
    }

    return activeMembership;
  }

  private buildSession(
    user: UserAccessRecord,
    activeMembership: UserAccessMembership,
  ): AuthSession {
    const defaultLocale =
      activeMembership.tenant.default_locale ?? DEFAULT_DISPLAY_LANGUAGE;
    const formatLocale =
      activeMembership.tenant.format_locale ?? DEFAULT_FORMAT_LOCALE;
    const session: AuthSession = {
      userId: user.firebaseUid,
      email: user.email,
      activeTenant: {
        id: activeMembership.tenant.id,
        name: activeMembership.tenant.name,
        slug: activeMembership.tenant.slug,
      },
      activeRole: activeMembership.role,
      activeSiteId: user.active_site_id,
      memberships: user.memberships.map((membership) => ({
        tenantId: membership.tenant_id,
        tenantName: membership.tenant.name,
        tenantSlug: membership.tenant.slug,
        role: membership.role,
        isActive: membership.is_active,
      })),
      locale: user.locale,
      defaultLocale,
      formatLocale,
      effectiveCapabilities: null,
      effectiveLocale: resolveUserLanguage(user.locale, defaultLocale),
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
