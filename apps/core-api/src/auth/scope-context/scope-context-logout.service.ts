import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { getFirebaseAdminAuth } from '../firebase-admin.js';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';
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
    private readonly systemPrisma: SystemPrismaService,
    @Inject(SCOPE_CONTEXT_IDP_PORT)
    private readonly idpPort: ScopeContextIdpPort,
  ) {}

  async logout(
    user: TenantAuthenticatedUser,
    bearerToken: string,
  ): Promise<void> {
    const verified =
      await this.idpPort.verifyIdTokenWithRevocation(bearerToken);

    if (verified.sub !== user.userId) {
      throw new UnauthorizedException(
        'Token subject does not match the session.',
      );
    }

    await getFirebaseAdminAuth().revokeRefreshTokens(verified.sub);
    const refreshTokensRevokedAt = new Date();

    const continuityDigest = buildContinuityDigest(
      verified.sub,
      verified.authTimeSeconds,
    );

    const memberships = await this.systemPrisma.tenantMember.findMany({
      where: {
        is_active: true,
        user: { firebaseUid: verified.sub },
      },
      select: {
        tenant_id: true,
        user: { select: { active_site_id: true } },
      },
    });

    if (memberships.length === 0) {
      return;
    }

    await this.endedLineages.recordEndedLineageForMemberships({
      sessionUser: user,
      principalSub: verified.sub,
      continuityDigest,
      authTimeSeconds: verified.authTimeSeconds,
      refreshTokensRevokedAt,
      memberships: memberships.map((row) => ({
        tenantId: row.tenant_id,
        siteId: row.user.active_site_id,
      })),
    });
  }
}
