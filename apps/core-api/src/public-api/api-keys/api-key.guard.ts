import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PUBLIC_API_SCOPE_KEY } from '../decorators/require-public-api-scope.decorator.js';
import type { PublicApiScope } from '../public-api-scopes.js';
import { ApiKeyAuthenticatorService } from './api-key-authenticator.service.js';
import {
  toApiKeyTenantUser,
  type ApiKeyPrincipal,
} from './api-key-principal.js';
import {
  ApiKeyRequestAuditService,
  describeApiKeyRoute,
} from './api-key-request-audit.service.js';
import { isApiKeyToken } from './api-key-token.js';

const BEARER_PREFIX = 'Bearer ';

/** Request shape after this guard: the verified principal is attached for the audit interceptor. */
export type ApiKeyRequest = Request & {
  user?: AuthenticatedUser;
  apiKeyPrincipal?: ApiKeyPrincipal;
};

/**
 * Global guard that runs before the Firebase session guard (ADR-0026).
 *
 * - Not a tenant API key (no `acp_live_` Bearer token): pass through to the session guard.
 * - API key on a @Public route: pass through unauthenticated, as for any other credential.
 * - API key otherwise: verify the secret, then apply in this order: revoked or expired (401), unmapped
 *   route (403, deny by default), missing scope (403), per-key budget (429 with Retry-After), and
 *   `last_used_at` (throttled). Every decision for an attributable key is audited.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authenticator: ApiKeyAuthenticatorService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: ApiKeyRequestAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<ApiKeyRequest>();
    const token = readBearerToken(request.headers.authorization);
    if (!token || !isApiKeyToken(token)) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const principal = await this.authenticator.verifyToken(token);
    const user = toApiKeyTenantUser(principal);
    request.user = user;
    request.apiKeyPrincipal = principal;
    this.tenantContext.setAuthenticatedUser(user);

    const scope = this.reflector.getAllAndOverride<PublicApiScope | undefined>(
      PUBLIC_API_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const refusal = {
      principal,
      method: request.method,
      route: describeApiKeyRoute(request),
      scope: scope ?? null,
    };
    const now = new Date();

    if (
      principal.revokedAt ||
      (principal.expiresAt && principal.expiresAt <= now)
    ) {
      await this.refuse(refusal, HttpStatus.UNAUTHORIZED, 'revoked_or_expired');
      throw new UnauthorizedException('Invalid API key.');
    }

    if (!scope) {
      await this.refuse(refusal, HttpStatus.FORBIDDEN, 'unmapped_endpoint');
      throw new ForbiddenException(
        'API keys are not accepted on this endpoint.',
      );
    }

    if (!principal.scopes.includes(scope)) {
      await this.refuse(refusal, HttpStatus.FORBIDDEN, 'missing_scope');
      throw new ForbiddenException(`API key is missing the ${scope} scope.`);
    }

    const decision = await this.authenticator.consumeRateLimit(principal, now);
    if (!decision.allowed) {
      http
        .getResponse<Response>()
        .setHeader('Retry-After', String(decision.retryAfterSeconds));
      await this.refuse(refusal, HttpStatus.TOO_MANY_REQUESTS, 'rate_limited');
      throw new HttpException(
        'API rate limit exceeded.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.authenticator.touchLastUsed(principal, now);
    return true;
  }

  private async refuse(
    refusal: {
      principal: ApiKeyPrincipal;
      method: string;
      route: string;
      scope: PublicApiScope | null;
    },
    httpStatus: number,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      ...refusal,
      httpStatus,
      outcome: 'REFUSED',
      reason,
    });
  }
}

function readBearerToken(
  authorization: string | undefined,
): string | undefined {
  if (!authorization?.startsWith(BEARER_PREFIX)) {
    return undefined;
  }

  const token = authorization.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}
