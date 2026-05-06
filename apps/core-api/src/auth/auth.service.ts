import { randomBytes } from 'node:crypto';
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
import { getFirebaseAdminAuth } from './firebase-admin';
import { AuthSessionService } from './auth-session.service';
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

@Injectable()
export class AuthService {
  private readonly testJwtSecret =
    process.env.TEST_JWT_SECRET ||
    (process.env.NODE_ENV === 'test'
      ? 'test-jwt-secret'
      : randomBytes(32).toString('hex'));

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
    private readonly authSessionService: AuthSessionService,
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
    const tenantUser = await this.authSessionService.resolveTenantUser(claims);

    if (options.allowPlatformAdmin && typeof claims.platformRole === 'string') {
      if (tenantUser) {
        return tenantUser;
      }

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

    if (tenantUser) {
      return tenantUser;
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

    throw new UnauthorizedException(
      'Bearer token is missing one or more required claims.',
    );
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

  private async verifyTestToken(
    token: string,
  ): Promise<AuthClaims | undefined> {
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
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
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
