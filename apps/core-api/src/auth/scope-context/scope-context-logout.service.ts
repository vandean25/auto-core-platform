import { Inject, Injectable } from '@nestjs/common';
import { getFirebaseAdminAuth } from '../firebase-admin.js';
import type { TenantAuthenticatedUser } from '../types/authenticated-user.js';
import { buildContinuityDigest } from './scope-context-token.js';
import { EndedSessionLineageService } from './ended-session-lineage.service.js';
import {
  SCOPE_CONTEXT_IDP_PORT,
  type ScopeContextIdpPort,
} from './scope-context-idp.port.js';

@Injectable()
export class ScopeContextLogoutService {
  constructor(
    private readonly endedLineages: EndedSessionLineageService,
    @Inject(SCOPE_CONTEXT_IDP_PORT)
    private readonly idpPort: ScopeContextIdpPort,
  ) {}

  async logout(
    user: TenantAuthenticatedUser,
    bearerToken: string,
  ): Promise<void> {
    const verified =
      await this.idpPort.verifyIdTokenWithRevocation(bearerToken);
    const continuityDigest = buildContinuityDigest(
      verified.sub,
      verified.authTimeSeconds,
    );
    const revokedAt = new Date();

    await this.endedLineages.recordEndedLineage({
      tenantId: user.tenantId,
      principalSub: verified.sub,
      continuityDigest,
      authTimeSeconds: verified.authTimeSeconds,
      siteId: user.activeSiteId ?? null,
      refreshTokensRevokedAt: revokedAt,
    });

    await getFirebaseAdminAuth().revokeRefreshTokens(verified.sub);
  }
}
