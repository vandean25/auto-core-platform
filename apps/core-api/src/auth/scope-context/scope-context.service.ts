import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { TenantAuthenticatedUser } from '../types/authenticated-user.js';
import { getScopeContextPolicyDigest } from './scope-context-policy-digest.js';
import { readScopeContextHmacSecrets } from './scope-context-secret.js';
import {
  buildContinuityDigest,
  mintScopeContextToken,
  scopeContextDigest,
  verifyScopeContextToken,
} from './scope-context-token.js';
import { EndedSessionLineageService } from './ended-session-lineage.service.js';
import {
  SCOPE_CONTEXT_IDP_PORT,
  type ScopeContextIdpPort,
} from './scope-context-idp.port.js';

export type ScopeContextHandshakeResult = {
  scopeContext: string;
  scopeContextDigest: string;
  continuityDigest: string;
};

@Injectable()
export class ScopeContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly endedLineages: EndedSessionLineageService,
    @Inject(SCOPE_CONTEXT_IDP_PORT)
    private readonly idpPort: ScopeContextIdpPort,
  ) {}

  async handshake(
    user: TenantAuthenticatedUser,
    bearerToken: string,
  ): Promise<ScopeContextHandshakeResult> {
    try {
      readScopeContextHmacSecrets();
    } catch {
      throw new ServiceUnavailableException('Scope context is not configured.');
    }

    const verified =
      await this.idpPort.verifyIdTokenWithRevocation(bearerToken);

    if (verified.sub !== user.userId) {
      throw new UnauthorizedException(
        'Token subject does not match the session.',
      );
    }

    const continuityDigest = buildContinuityDigest(
      verified.sub,
      verified.authTimeSeconds,
    );

    if (
      await this.endedLineages.isLineageEnded(
        user.tenantId,
        verified.sub,
        verified.authTimeSeconds,
      )
    ) {
      throw new UnauthorizedException('Session lineage has ended.');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const member = await tx.tenantMember.findFirst({
          where: {
            tenant_id: user.tenantId,
            user: { firebaseUid: user.userId },
            is_active: true,
          },
          select: { scope_epoch: true },
        });
        if (!member) {
          throw new UnauthorizedException('Tenant membership is not active.');
        }

        const tenant = await tx.tenant.findFirst({
          where: { id: user.tenantId, is_active: true },
          select: { authorization_epoch: true },
        });
        if (!tenant) {
          throw new UnauthorizedException('Tenant is not active.');
        }

        const dbUser = await tx.user.findFirst({
          where: { firebaseUid: user.userId },
          select: { active_site_id: true },
        });
        const siteId = dbUser?.active_site_id;
        if (!siteId) {
          throw new UnprocessableEntityException({
            statusCode: 422,
            code: 'ACTIVE_SITE_REQUIRED',
            message: 'An active site is required.',
          });
        }

        const policyVersion = getScopeContextPolicyDigest();
        const scopeContext = mintScopeContextToken({
          principalSub: verified.sub,
          continuityDigest,
          tenantId: user.tenantId,
          siteId,
          scopeEpoch: member.scope_epoch,
          authorizationEpoch: tenant.authorization_epoch,
          policyVersion,
        });

        return {
          scopeContext,
          scopeContextDigest: scopeContextDigest(scopeContext),
          continuityDigest,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  tryEchoScopeContextDigest(
    headerValue: string | undefined,
  ): string | undefined {
    if (!headerValue?.trim()) {
      return undefined;
    }
    try {
      const token = headerValue.trim();
      verifyScopeContextToken(token);
      return scopeContextDigest(token);
    } catch {
      return undefined;
    }
  }
}
