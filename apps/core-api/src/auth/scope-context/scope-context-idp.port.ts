import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirebaseAdminAuth } from '../firebase-admin.js';

export type VerifiedIdpToken = {
  sub: string;
  authTimeSeconds: number;
  email?: string;
};

export const SCOPE_CONTEXT_IDP_PORT = Symbol('SCOPE_CONTEXT_IDP_PORT');

export interface ScopeContextIdpPort {
  verifyIdTokenWithRevocation(bearerToken: string): Promise<VerifiedIdpToken>;
}

@Injectable()
export class FirebaseScopeContextIdpAdapter implements ScopeContextIdpPort {
  async verifyIdTokenWithRevocation(
    bearerToken: string,
  ): Promise<VerifiedIdpToken> {
    try {
      const decoded = await getFirebaseAdminAuth().verifyIdToken(
        bearerToken,
        true,
      );
      return mapDecodedIdpToken(decoded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UnauthorizedException(`Invalid or revoked token: ${message}`);
    }
  }
}

@Injectable()
export class TestScopeContextIdpAdapter implements ScopeContextIdpPort {
  constructor(private readonly jwtService: JwtService) {}

  async verifyIdTokenWithRevocation(
    bearerToken: string,
  ): Promise<VerifiedIdpToken> {
    const testSecret =
      process.env.NODE_ENV === 'test'
        ? process.env.TEST_JWT_SECRET?.trim()
        : undefined;
    if (!testSecret) {
      return new FirebaseScopeContextIdpAdapter().verifyIdTokenWithRevocation(
        bearerToken,
      );
    }

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        auth_time?: number;
      }>(bearerToken, { secret: testSecret });
      if (typeof payload.sub !== 'string') {
        throw new UnauthorizedException('Invalid test token subject.');
      }
      const authTime =
        typeof payload.auth_time === 'number'
          ? payload.auth_time
          : Math.floor(Date.now() / 1000);
      return { sub: payload.sub, authTimeSeconds: authTime };
    } catch {
      throw new UnauthorizedException('Invalid or revoked test token.');
    }
  }
}

export class FakeScopeContextIdpAdapter implements ScopeContextIdpPort {
  private mode: 'ok' | 'revoked' | 'unreachable' = 'ok';

  setMode(mode: 'ok' | 'revoked' | 'unreachable'): void {
    this.mode = mode;
  }

  reset(): void {
    this.mode = 'ok';
  }

  async verifyIdTokenWithRevocation(
    bearerToken: string,
  ): Promise<VerifiedIdpToken> {
    if (this.mode === 'unreachable') {
      throw new ServiceUnavailableException(
        'Identity provider is unreachable.',
      );
    }
    if (this.mode === 'revoked') {
      throw new UnauthorizedException('User has been revoked at the IdP.');
    }

    const secret = process.env.TEST_JWT_SECRET?.trim();
    if (!secret) {
      throw new UnauthorizedException('TEST_JWT_SECRET is not configured.');
    }
    return new TestScopeContextIdpAdapter(
      new JwtService({ secret }),
    ).verifyIdTokenWithRevocation(bearerToken);
  }
}

function mapDecodedIdpToken(decoded: DecodedIdToken): VerifiedIdpToken {
  const authTime =
    typeof decoded.auth_time === 'number'
      ? decoded.auth_time
      : Math.floor(Date.now() / 1000);
  return {
    sub: decoded.uid,
    authTimeSeconds: authTime,
    email: decoded.email,
  };
}
