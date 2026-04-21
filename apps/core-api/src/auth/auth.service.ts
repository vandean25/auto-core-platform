import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAuth } from 'firebase-admin/auth';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './types/authenticated-user';

type AuthClaims = {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  iss?: string;
};

@Injectable()
export class AuthService {
  private readonly testJwtSecret = 'test-jwt-secret';

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async authenticateBearerToken(
    authorizationHeader?: string,
  ): Promise<AuthenticatedUser> {
    const token = this.extractBearerToken(authorizationHeader);
    const claims = await this.verifyToken(token);

    if (
      process.env.NODE_ENV === 'test' &&
      claims.iss === 'local-test-fixture'
    ) {
      return {
        userId: claims.sub,
        email: claims.email,
        tenantId: claims.tenantId,
        role: claims.role,
      };
    }

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

    return {
      userId: claims.sub,
      email: claims.email,
      tenantId: claims.tenantId,
      role: claims.role,
    };
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

  private async verifyToken(token: string): Promise<AuthClaims> {
    if (process.env.NODE_ENV === 'test') {
      try {
        const payload = await this.jwtService.verifyAsync<AuthClaims>(token, {
          secret: this.testJwtSecret,
        });
        return this.assertClaims(payload);
      } catch {
        // Fall through to Firebase verification so auth-specific tests can still
        // exercise rejection paths with non-fixture tokens.
      }
    }

    try {
      const decoded = await getAuth(this.getFirebaseApp()).verifyIdToken(token);
      return this.assertClaims(this.mapFirebaseClaims(decoded));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UnauthorizedException(`Invalid or expired token: ${message}`);
    }
  }

  private assertClaims(payload: Partial<AuthClaims>): AuthClaims {
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      throw new UnauthorizedException(
        'Bearer token is missing one or more required claims.',
      );
    }

    return {
      sub: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
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

    return {
      sub: decoded.uid,
      email: decoded.email,
      tenantId,
      role,
      iss: decoded.iss,
    };
  }

  private getFirebaseApp() {
    if (getApps().length > 0) {
      return getApp();
    }

    const projectId =
      process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
    const rawCredentials = process.env.GCP_CREDENTIALS;

    if (rawCredentials) {
      const parsed = JSON.parse(rawCredentials) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };

      if (parsed.client_email && parsed.private_key) {
        return initializeApp({
          credential: cert({
            projectId: parsed.project_id ?? projectId,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key,
          }),
          projectId: parsed.project_id ?? projectId,
        });
      }
    }

    return initializeApp({
      credential: applicationDefault(),
      projectId,
    });
  }
}
