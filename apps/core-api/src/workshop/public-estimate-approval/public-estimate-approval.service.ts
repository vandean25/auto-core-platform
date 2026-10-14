import {
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  EstimateApprovalChannel,
  EstimateApprovalDecision,
  WorkshopEstimateStatus,
} from '@prisma/client';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  hashApprovalToken,
  isApprovalTokenUsable,
} from '../workshop-estimate-approval-token.helpers.js';
import type { WorkshopEstimateSnapshot } from '../workshop-estimate-snapshot.js';
import {
  ESTIMATE_APPROVAL_ERRORS,
  ESTIMATE_APPROVAL_TOKEN_DECISION_LIMIT,
  ESTIMATE_APPROVAL_TOKEN_PATTERN,
  ESTIMATE_APPROVAL_TOKEN_READ_LIMIT,
  ESTIMATE_APPROVAL_TOKEN_WINDOW_MS,
} from './public-estimate-approval.constants.js';
import {
  PublicEstimateDecision,
  type PublicEstimateDecisionDto,
} from './public-estimate-approval.dto.js';
import { PublicEstimateApprovalLookup } from './public-estimate-approval.lookup.js';
import { PublicEstimateApprovalRateLimiter } from './public-estimate-approval.rate-limit.js';
import {
  projectPublicEstimate,
  type PublicEstimateView,
} from './public-estimate-approval.projection.js';

/** Request facts kept as evidence on a decision. Truncated to the column sizes the evidence row allows. */
export type PublicApprovalRequestMeta = {
  ip: string | null;
  userAgent: string | null;
  acceptLanguage: string | null;
};

export type PublicEstimateDecisionResult = {
  decision: 'APPROVED' | 'DECLINED';
  decided_at: string;
};

type ResolvedApproval = {
  tokenId: string;
  tenantId: string;
  versionId: string;
};

const MAX_IP_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_ACCEPT_LANGUAGE_LENGTH = 200;

/**
 * The public approval route (ADR-0025 §7, AUT-373). A read is repeatable and changes nothing except the
 * on-access expiry. A decision consumes the token, moves the version and writes the evidence row in one
 * transaction, guarded by updateMany on the token and the version status.
 */
@Injectable()
export class PublicEstimateApprovalService {
  constructor(
    private readonly lookup: PublicEstimateApprovalLookup,
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly limiter: PublicEstimateApprovalRateLimiter,
  ) {}

  async read(rawToken: string, now = new Date()): Promise<PublicEstimateView> {
    this.consumeTokenRate(
      rawToken,
      'read',
      ESTIMATE_APPROVAL_TOKEN_READ_LIMIT,
      now,
    );
    const approval = await this.resolve(rawToken, now);
    const version = await this.prisma.workshopEstimateVersion.findFirst({
      where: { tenant_id: approval.tenantId, id: approval.versionId },
      select: { status: true, snapshot: true },
    });
    if (!version || version.status !== WorkshopEstimateStatus.SENT) {
      throw this.notDecidable();
    }
    if (!version.snapshot) {
      throw this.notDecidable();
    }
    return projectPublicEstimate(version.snapshot as WorkshopEstimateSnapshot);
  }

  async decide(
    rawToken: string,
    dto: PublicEstimateDecisionDto,
    request: PublicApprovalRequestMeta,
    now = new Date(),
  ): Promise<PublicEstimateDecisionResult> {
    this.consumeTokenRate(
      rawToken,
      'decision',
      ESTIMATE_APPROVAL_TOKEN_DECISION_LIMIT,
      now,
    );
    const approve = dto.decision === PublicEstimateDecision.APPROVE;
    const typedFullName = dto.typed_full_name?.trim() ?? '';
    if (
      approve &&
      (!dto.legal_blocks_accepted ||
        !dto.b2c_declaration_accepted ||
        typedFullName.length < 2)
    ) {
      throw new UnprocessableEntityException(
        ESTIMATE_APPROVAL_ERRORS.incomplete,
      );
    }

    const approval = await this.resolve(rawToken, now);
    const version = await this.prisma.workshopEstimateVersion.findFirst({
      where: { tenant_id: approval.tenantId, id: approval.versionId },
      select: {
        status: true,
        snapshot: true,
        snapshot_sha256: true,
        pdf_sha256: true,
        legal_text_version: true,
        legal_text_sha256: true,
      },
    });
    if (
      !version ||
      version.status !== WorkshopEstimateStatus.SENT ||
      !version.snapshot ||
      !version.snapshot_sha256 ||
      !version.legal_text_version ||
      !version.legal_text_sha256
    ) {
      throw this.notDecidable();
    }
    const snapshot = version.snapshot as WorkshopEstimateSnapshot;
    const decision = approve
      ? EstimateApprovalDecision.APPROVED
      : EstimateApprovalDecision.DECLINED;
    // Captured before the transaction: narrowing on the version does not carry into the callback.
    const contentSha256 = version.snapshot_sha256;
    const legalTextVersion = version.legal_text_version;
    const legalTextSha256 = version.legal_text_sha256;

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.workshopEstimateApprovalToken.updateMany({
        where: {
          tenant_id: approval.tenantId,
          id: approval.tokenId,
          consumed_at: null,
          invalidated_at: null,
          expires_at: { gt: now },
        },
        data: { consumed_at: now },
      });
      if (consumed.count !== 1) {
        throw this.unavailable();
      }

      const moved = await tx.workshopEstimateVersion.updateMany({
        where: {
          tenant_id: approval.tenantId,
          id: approval.versionId,
          status: WorkshopEstimateStatus.SENT,
        },
        data: {
          status: approve
            ? WorkshopEstimateStatus.APPROVED
            : WorkshopEstimateStatus.DECLINED,
        },
      });
      if (moved.count !== 1) {
        throw this.notDecidable();
      }

      await tx.workshopEstimateApproval.create({
        data: {
          tenant_id: approval.tenantId,
          workshop_estimate_version_id: approval.versionId,
          approval_token_id: approval.tokenId,
          channel: EstimateApprovalChannel.LINK,
          decision,
          decided_at: now,
          content_sha256: contentSha256,
          pdf_sha256: version.pdf_sha256,
          legal_text_version: legalTextVersion,
          legal_text_sha256: legalTextSha256,
          recipient_email: snapshot.customer.email ?? null,
          typed_full_name: approve ? typedFullName : null,
          legal_blocks_accepted: approve,
          b2c_declaration_accepted: approve,
          ip_address: truncate(request.ip, MAX_IP_LENGTH),
          user_agent: truncate(request.userAgent, MAX_USER_AGENT_LENGTH),
          accept_language: truncate(
            request.acceptLanguage,
            MAX_ACCEPT_LANGUAGE_LENGTH,
          ),
        },
      });
    });

    return {
      decision: approve ? 'APPROVED' : 'DECLINED',
      decided_at: now.toISOString(),
    };
  }

  /**
   * Finds the token, sets the tenant for the rest of the request, and checks that the link can still be used.
   * Unknown tokens, expired or used links, and superseded or expired versions answer generically. A version
   * that is no longer SENT for another reason answers 409. A version past valid_until is marked EXPIRED here.
   */
  private async resolve(
    rawToken: string,
    now: Date,
  ): Promise<ResolvedApproval> {
    if (!ESTIMATE_APPROVAL_TOKEN_PATTERN.test(rawToken)) {
      throw this.notFound();
    }
    const row = await this.lookup.findByTokenHash(hashApprovalToken(rawToken));
    if (!row) {
      throw this.notFound();
    }
    this.tenantContext.setPublicEstimateApprovalTenant(row.tenant_id);

    const tokenUsable = isApprovalTokenUsable(
      {
        expires_at: row.expires_at,
        invalidated_at: row.invalidated_at,
        consumed_at: row.consumed_at,
      },
      now,
    );
    if (!tokenUsable) {
      throw this.unavailable();
    }

    const version = await this.prisma.workshopEstimateVersion.findFirst({
      where: {
        tenant_id: row.tenant_id,
        id: row.workshop_estimate_version_id,
      },
      select: { status: true, valid_until: true },
    });
    if (!version) {
      throw this.notFound();
    }
    if (
      version.status === WorkshopEstimateStatus.SUPERSEDED ||
      version.status === WorkshopEstimateStatus.EXPIRED
    ) {
      throw this.unavailable();
    }
    if (
      version.status === WorkshopEstimateStatus.SENT &&
      version.valid_until !== null &&
      version.valid_until.getTime() <= now.getTime()
    ) {
      await this.prisma.workshopEstimateVersion.updateMany({
        where: {
          tenant_id: row.tenant_id,
          id: row.workshop_estimate_version_id,
          status: WorkshopEstimateStatus.SENT,
        },
        data: { status: WorkshopEstimateStatus.EXPIRED },
      });
      throw this.unavailable();
    }
    if (version.status !== WorkshopEstimateStatus.SENT) {
      throw this.notDecidable();
    }

    return {
      tokenId: row.id,
      tenantId: row.tenant_id,
      versionId: row.workshop_estimate_version_id,
    };
  }

  private consumeTokenRate(
    rawToken: string,
    kind: 'read' | 'decision',
    limit: number,
    now: Date,
  ): void {
    const key = `${kind}:${hashApprovalToken(rawToken)}`;
    if (
      !this.limiter.consume(
        key,
        limit,
        ESTIMATE_APPROVAL_TOKEN_WINDOW_MS,
        now.getTime(),
      )
    ) {
      throw new HttpException(
        ESTIMATE_APPROVAL_ERRORS.rateLimited,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException(ESTIMATE_APPROVAL_ERRORS.notFound);
  }

  private unavailable(): GoneException {
    return new GoneException(ESTIMATE_APPROVAL_ERRORS.unavailable);
  }

  private notDecidable(): ConflictException {
    return new ConflictException(ESTIMATE_APPROVAL_ERRORS.notDecidable);
  }
}

function truncate(value: string | null, max: number): string | null {
  if (value === null) {
    return null;
  }
  return value.slice(0, max);
}
