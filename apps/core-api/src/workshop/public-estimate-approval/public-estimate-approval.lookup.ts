import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';

/** Approval token row read before any tenant context exists. The row names its tenant. */
export type PublicEstimateApprovalTokenRow = {
  id: string;
  tenant_id: string;
  workshop_estimate_version_id: string;
  expires_at: Date;
  invalidated_at: Date | null;
  consumed_at: Date | null;
};

/**
 * The only pre-tenant read of approval tokens (ADR-0025 §7). It is listed in system-prisma-allowlist.md. The
 * lookup is by SHA-256 of the raw token, so the raw value never reaches the database. Every later query runs
 * through PrismaService under the tenant this row names.
 */
@Injectable()
export class PublicEstimateApprovalLookup {
  constructor(private readonly systemPrisma: SystemPrismaService) {}

  async findByTokenHash(
    tokenSha256: string,
  ): Promise<PublicEstimateApprovalTokenRow | null> {
    return this.systemPrisma.workshopEstimateApprovalToken.findFirst({
      where: { token_sha256: tokenSha256 },
      select: {
        id: true,
        tenant_id: true,
        workshop_estimate_version_id: true,
        expires_at: true,
        invalidated_at: true,
        consumed_at: true,
      },
    });
  }
}
