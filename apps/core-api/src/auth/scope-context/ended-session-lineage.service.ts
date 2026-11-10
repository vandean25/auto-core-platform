import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantContextStorage } from '../../common/services/tenant-context.storage.js';
import type { TenantAuthenticatedUser } from '../types/authenticated-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SCOPE_CONTEXT_ID_TOKEN_LIFETIME_SECONDS } from './scope-context.constants.js';
import { continuityDigestCandidates } from './scope-context-token.js';

@Injectable()
export class EndedSessionLineageService {
  constructor(private readonly prisma: PrismaService) {}

  async recordEndedLineageForMemberships(input: {
    sessionUser: TenantAuthenticatedUser;
    principalSub: string;
    continuityDigest: string;
    authTimeSeconds: number;
    memberships: ReadonlyArray<{
      tenantId: string;
      siteId: string | null;
    }>;
    refreshTokensRevokedAt: Date;
  }): Promise<void> {
    for (const membership of input.memberships) {
      await TenantContextStorage.run(async () => {
        TenantContextStorage.setUser({
          userId: input.sessionUser.userId,
          email: input.sessionUser.email,
          tenantId: membership.tenantId,
          role:
            membership.tenantId === input.sessionUser.tenantId
              ? input.sessionUser.role
              : 'ADMIN',
        });

        await this.prisma.endedSessionLineage.upsert({
          where: {
            tenant_id_continuity_digest: {
              tenant_id: membership.tenantId,
              continuity_digest: input.continuityDigest,
            },
          },
          create: {
            tenant_id: membership.tenantId,
            principal_sub: input.principalSub,
            continuity_digest: input.continuityDigest,
            auth_time_seconds: BigInt(input.authTimeSeconds),
            site_id: membership.siteId,
            refresh_tokens_revoked_at: input.refreshTokensRevokedAt,
          },
          update: {
            ended_at: new Date(),
            refresh_tokens_revoked_at: input.refreshTokensRevokedAt,
            site_id: membership.siteId,
          },
        });
      });
    }
  }

  async isLineageEnded(
    tenantId: string,
    principalSub: string,
    authTimeSeconds: number,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (!tx) {
      await this.pruneExpiredRows(tenantId);
    }
    const digests = continuityDigestCandidates(principalSub, authTimeSeconds);
    const client = tx ?? this.prisma;
    const row = await client.endedSessionLineage.findFirst({
      where: {
        tenant_id: tenantId,
        continuity_digest: { in: [...digests] },
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  async pruneExpiredRowsForTenant(tenantId: string): Promise<void> {
    await this.pruneExpiredRows(tenantId);
  }

  private async pruneExpiredRows(tenantId: string): Promise<void> {
    const lifetimeSeconds = SCOPE_CONTEXT_ID_TOKEN_LIFETIME_SECONDS;
    const cutoff = new Date(Date.now() - lifetimeSeconds * 1000);
    await TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        userId: 'scope-context-prune',
        email: 'scope-context-prune@internal',
        tenantId,
        role: 'ADMIN',
      });

      const staleRows = await this.prisma.endedSessionLineage.findMany({
        where: {
          refresh_tokens_revoked_at: { not: null, lte: cutoff },
        },
        select: {
          id: true,
          auth_time_seconds: true,
          refresh_tokens_revoked_at: true,
        },
      });

      const revokeConfirmedRowIds = staleRows
        .filter((row) => {
          const revokedAt = row.refresh_tokens_revoked_at;
          if (!revokedAt) {
            return false;
          }
          const revokedEpochSeconds = Math.floor(revokedAt.getTime() / 1000);
          return row.auth_time_seconds <= BigInt(revokedEpochSeconds);
        })
        .map((row) => row.id);

      if (revokeConfirmedRowIds.length === 0) {
        return;
      }

      await this.prisma.endedSessionLineage.deleteMany({
        where: { id: { in: revokeConfirmedRowIds } },
      });
    });
  }
}
