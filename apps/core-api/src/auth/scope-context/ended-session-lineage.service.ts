import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SCOPE_CONTEXT_ID_TOKEN_LIFETIME_SECONDS } from './scope-context.constants.js';

@Injectable()
export class EndedSessionLineageService {
  constructor(private readonly prisma: PrismaService) {}

  async recordEndedLineage(input: {
    tenantId: string;
    principalSub: string;
    continuityDigest: string;
    authTimeSeconds: number;
    siteId: string | null;
    refreshTokensRevokedAt: Date;
  }): Promise<void> {
    const existing = await this.prisma.endedSessionLineage.findFirst({
      where: {
        tenant_id: input.tenantId,
        continuity_digest: input.continuityDigest,
      },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.endedSessionLineage.update({
        where: { id: existing.id },
        data: {
          ended_at: new Date(),
          refresh_tokens_revoked_at: input.refreshTokensRevokedAt,
        },
      });
      return;
    }
    await this.prisma.endedSessionLineage.create({
      data: {
        tenant_id: input.tenantId,
        principal_sub: input.principalSub,
        continuity_digest: input.continuityDigest,
        auth_time_seconds: BigInt(input.authTimeSeconds),
        site_id: input.siteId,
        refresh_tokens_revoked_at: input.refreshTokensRevokedAt,
      },
    });
  }

  async isLineageEnded(
    tenantId: string,
    continuityDigest: string,
  ): Promise<boolean> {
    await this.pruneExpiredRows(tenantId);
    const row = await this.prisma.endedSessionLineage.findFirst({
      where: {
        tenant_id: tenantId,
        continuity_digest: continuityDigest,
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  private async pruneExpiredRows(tenantId: string): Promise<void> {
    const cutoffSeconds = SCOPE_CONTEXT_ID_TOKEN_LIFETIME_SECONDS;
    const rows = await this.prisma.endedSessionLineage.findMany({
      where: {
        tenant_id: tenantId,
        refresh_tokens_revoked_at: { not: null },
      },
      select: {
        id: true,
        refresh_tokens_revoked_at: true,
      },
    });
    const nowMs = Date.now();
    const deletable = rows
      .filter((row) => {
        if (!row.refresh_tokens_revoked_at) {
          return false;
        }
        const elapsedSeconds =
          (nowMs - row.refresh_tokens_revoked_at.getTime()) / 1000;
        return elapsedSeconds >= cutoffSeconds;
      })
      .map((row) => row.id);

    if (deletable.length === 0) {
      return;
    }

    await this.prisma.endedSessionLineage.deleteMany({
      where: { id: { in: deletable } },
    });
  }
}
