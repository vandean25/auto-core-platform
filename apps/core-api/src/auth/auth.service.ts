import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { PrismaService } from '../prisma/prisma.service';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { getFirebaseAdminAuth } from './firebase-admin';
import type {
  AuthenticatedUser,
  TenantAuthenticatedUser,
} from './types/authenticated-user';

type AuthClaims = {
  sub: string;
  email: string;
  tenantId?: string;
  role?: string;
  platformRole?: string;
  iss?: string;
};

type AuthenticateBearerTokenOptions = {
  allowPlatformAdmin?: boolean;
};

type MembershipLookupWhere = {
  OR: Array<{
    firebaseUid?: string;
    email?: string;
  }>;
};

@Injectable()
export class AuthService {
  private readonly testJwtSecret = 'test-jwt-secret';

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async authenticateBearerToken(
    authorizationHeader?: string,
  ): Promise<TenantAuthenticatedUser>;
  async authenticateBearerToken(
    authorizationHeader: string | undefined,
    options: { allowPlatformAdmin: true },
  ): Promise<AuthenticatedUser>;
  async authenticateBearerToken(
    authorizationHeader?: string,
    options: AuthenticateBearerTokenOptions = {},
  ): Promise<AuthenticatedUser> {
    const token = this.extractBearerToken(authorizationHeader);
    const claims = await this.verifyToken(token, options);

    if (options.allowPlatformAdmin && typeof claims.platformRole === 'string') {
      return {
        userId: claims.sub,
        email: claims.email,
        ...(typeof claims.tenantId === 'string'
          ? { tenantId: claims.tenantId }
          : {}),
        ...(typeof claims.role === 'string' ? { role: claims.role } : {}),
        platformRole: claims.platformRole,
      };
    }

    if (
      typeof claims.tenantId === 'string' &&
      typeof claims.role === 'string'
    ) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { id: claims.tenantId },
        select: { id: true, is_active: true },
      });

      if (!tenant) {
        throw new UnauthorizedException('Invalid tenant.');
      }

      if (!tenant.is_active) {
        throw new ForbiddenException('Tenant is inactive.');
      }

      return typeof claims.platformRole === 'string'
        ? {
            userId: claims.sub,
            email: claims.email,
            tenantId: claims.tenantId,
            role: claims.role,
            platformRole: claims.platformRole,
          }
        : {
            userId: claims.sub,
            email: claims.email,
            tenantId: claims.tenantId,
            role: claims.role,
          };
    }

    const tenantClaims = await this.resolveTenantClaimsFromDatabase(claims);

    if (!tenantClaims) {
      throw new UnauthorizedException(
        'Bearer token is missing one or more required claims.',
      );
    }

    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantClaims.tenantId },
      select: { id: true, is_active: true },
    });

    if (!tenant) {
      throw new UnauthorizedException('Invalid tenant.');
    }

    if (!tenant.is_active) {
      throw new ForbiddenException('Tenant is inactive.');
    }

    return typeof claims.platformRole === 'string'
      ? {
          ...tenantClaims,
          platformRole: claims.platformRole,
        }
      : tenantClaims;
  }

  createTestToken(overrides: Partial<AuthClaims> = {}): string {
    return this.jwtService.sign(
      {
        sub: 'e2e-user-id',
        email: 'e2e@example.com',
        tenantId: 'e2e-tenant-id',
        role: 'ADMIN',
        iss: 'local-test-fixture',
        ...overrides,
      },
      { secret: this.testJwtSecret },
    );
  }

  private extractBearerToken(authorizationHeader?: string): string {
    if (!authorizationHeader) {
      throw new UnauthorizedException('Missing Authorization header.');
    }

    const [scheme, token] = authorizationHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization header.');
    }

    return token;
  }

  private async verifyToken(
    token: string,
    options: AuthenticateBearerTokenOptions = {},
  ): Promise<AuthClaims> {
    if (process.env.NODE_ENV === 'test') {
      const payload = await this.verifyTestToken(token);

      if (payload) {
        return this.assertClaims(payload, options);
      }

      // Fall through to Firebase verification so auth-specific tests can still
      // exercise rejection paths with non-fixture tokens.
    }

    try {
      const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
      return this.assertClaims(this.mapFirebaseClaims(decoded), options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UnauthorizedException(`Invalid or expired token: ${message}`);
    }
  }

  private async verifyTestToken(token: string): Promise<AuthClaims | undefined> {
    try {
      return await this.jwtService.verifyAsync<AuthClaims>(token, {
        secret: this.testJwtSecret,
      });
    } catch {
      return undefined;
    }
  }

  private assertClaims(
    payload: Partial<AuthClaims>,
    options: AuthenticateBearerTokenOptions = {},
  ): AuthClaims {
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string'
    ) {
      throw new UnauthorizedException(
        'Bearer token is missing one or more required claims.',
      );
    }

    return {
      sub: payload.sub,
      email: payload.email,
      tenantId:
        typeof payload.tenantId === 'string' ? payload.tenantId : undefined,
      role: typeof payload.role === 'string' ? payload.role : undefined,
      platformRole:
        typeof payload.platformRole === 'string'
          ? payload.platformRole
          : undefined,
      iss: payload.iss,
    };
  }

  private async resolveTenantClaimsFromDatabase(
    claims: AuthClaims,
  ): Promise<TenantAuthenticatedUser | null> {
    const lookupWhere: MembershipLookupWhere = {
      OR: [{ email: claims.email }],
    };

    if (claims.sub) {
      lookupWhere.OR.unshift({ firebaseUid: claims.sub });
    }

    const user = await this.systemPrisma.user.findFirst({
      where: lookupWhere,
      select: {
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
            tenant: {
              select: {
                id: true,
                is_active: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    const activeMembership =
      user.memberships.find(
        (membership) => membership.tenant_id === user.active_tenant_id,
      ) ?? user.memberships[0];

    if (!activeMembership) {
      return null;
    }

    const nextUser: TenantAuthenticatedUser = {
      userId: claims.sub,
      email: claims.email,
      tenantId: activeMembership.tenant_id,
      role: activeMembership.role,
    };

    if (user.platformAdmin?.is_active) {
      nextUser.platformRole = user.platformAdmin.role;
    }

    return nextUser;
  }

  private mapFirebaseClaims(decoded: DecodedIdToken): Partial<AuthClaims> {
    const tenantId =
      typeof decoded.tenantId === 'string'
        ? decoded.tenantId
        : typeof decoded.tenant_id === 'string'
          ? decoded.tenant_id
          : undefined;

    const role =
      typeof decoded.role === 'string'
        ? decoded.role
        : typeof decoded.roles === 'string'
          ? decoded.roles
          : undefined;

    const platformRole =
      typeof decoded.platformRole === 'string'
        ? decoded.platformRole
        : typeof decoded.platform_role === 'string'
          ? decoded.platform_role
          : undefined;

    return {
      sub: decoded.uid,
      email: decoded.email,
      tenantId,
      role,
      platformRole,
      iss: decoded.iss,
    };
  }
}
