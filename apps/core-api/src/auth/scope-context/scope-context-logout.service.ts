import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { getFirebaseAdminAuth } from '../firebase-admin.js';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';
import type { TenantAuthenticatedUser } from '../types/authenticated-user.js';
import { throwMappedFirebaseRevokeError } from './scope-context-idp-firebase-errors.js';
import { buildContinuityDigest } from './scope-context-token.js';
import { readScopeContextHmacSecrets } from './scope-context-secret.js';
import { findValidatedActiveSiteIdForTenant } from './scope-context-active-site.js';
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

    try {
      await getFirebaseAdminAuth().revokeRefreshTokens(verified.sub);
    } catch (error) {
      throwMappedFirebaseRevokeError(error);
    }
    const refreshTokensRevokedAt = new Date();

    const memberships = await this.systemPrisma.tenantMember.findMany({
      where: {
        is_active: true,
        user: { firebaseUid: verified.sub },
      },
      select: {
        tenant_id: true,
      },
    });

    if (memberships.length === 0) {
      return;
    }

    const membershipSites = await Promise.all(
      memberships.map(async (row) => ({
        tenantId: row.tenant_id,
        siteId: await findValidatedActiveSiteIdForTenant(
          this.systemPrisma,
          verified.sub,
          row.tenant_id,
        ),
      })),
    );

    await this.endedLineages.recordEndedLineageForMemberships({
      sessionUser: user,
      principalSub: verified.sub,
      continuityDigest,
      authTimeSeconds: verified.authTimeSeconds,
      refreshTokensRevokedAt,
      memberships: membershipSites,
    });
  }
}
