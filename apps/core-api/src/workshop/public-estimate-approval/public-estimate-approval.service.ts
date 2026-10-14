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
  AuditActorType,
  AuditLogAction,
  EstimateApprovalChannel,
  EstimateApprovalDecision,
  type Prisma,
  WorkshopEstimateStatus,
} from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { NotificationOutboxService } from '../../notifications/notification-outbox.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { enqueueEstimateDecisionEvent } from '../workshop-estimate-decision.helpers.js';
import { hashApprovalToken } from '../workshop-estimate-approval-token.helpers.js';
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
    private readonly audit: AuditService,
    private readonly outbox: NotificationOutboxService,
  ) {}

  async read(rawToken: string, now = new Date()): Promise<PublicEstimateView> {
    this.assertWellFormed(rawToken);
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
    this.assertWellFormed(rawToken);
    this.consumeTokenRate(
      rawToken,
      'decision',
      ESTIMATE_APPROVAL_TOKEN_DECISION_LIMIT,
      now,
    );
    const input = decisionInput(dto);
    const approval = await this.resolve(rawToken, now);
    const version = await this.loadDecidableVersion(approval);
    await this.prisma.$transaction((tx) =>
      this.recordDecision(tx, approval, version, input, request, now),
    );
    return {
      decision: input.approve ? 'APPROVED' : 'DECLINED',
      decided_at: now.toISOString(),
    };
  }

  /**
   * One transaction: the token is consumed, the version moves out of SENT, the evidence row is written, and the audit
   * row and the domain event follow it (ADR-0025 §7, AUT-355).
   */
  private async recordDecision(
    tx: Prisma.TransactionClient,
    approval: ResolvedApproval,
    version: DecidableVersion,
    input: DecisionInput,
    request: PublicApprovalRequestMeta,
    now: Date,
  ): Promise<void> {
    await this.consumeToken(tx, approval, now);
    await this.moveVersion(tx, approval, input.approve);
    const created = await this.createEvidence(
      tx,
      approval,
      version,
      input,
      request,
      now,
    );
    await this.recordAuditAndEvent(
      tx,
      approval,
      version,
      input,
      created.id,
      now,
    );
  }

  private async loadDecidableVersion(
    approval: ResolvedApproval,
  ): Promise<DecidableVersion> {
    const version = await this.prisma.workshopEstimateVersion.findFirst({
      where: { tenant_id: approval.tenantId, id: approval.versionId },
      select: {
        status: true,
        snapshot: true,
        snapshot_sha256: true,
        pdf_sha256: true,
        legal_text_version: true,
        legal_text_sha256: true,
        total_gross: true,
        estimate: { select: { workshop_order_id: true } },
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
    return {
      snapshot: version.snapshot as WorkshopEstimateSnapshot,
      snapshot_sha256: version.snapshot_sha256,
      pdf_sha256: version.pdf_sha256,
      legal_text_version: version.legal_text_version,
      legal_text_sha256: version.legal_text_sha256,
      total_gross: version.total_gross,
      workshop_order_id: version.estimate.workshop_order_id,
    };
  }

  private async consumeToken(
    tx: Prisma.TransactionClient,
    approval: ResolvedApproval,
    now: Date,
  ): Promise<void> {
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
  }

  /** Guarded by SENT: a concurrent decision or supersession makes this update match nothing. */
  private async moveVersion(
    tx: Prisma.TransactionClient,
    approval: ResolvedApproval,
    approve: boolean,
  ): Promise<void> {
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
  }

  private createEvidence(
    tx: Prisma.TransactionClient,
    approval: ResolvedApproval,
    version: DecidableVersion,
    input: DecisionInput,
    request: PublicApprovalRequestMeta,
    now: Date,
  ) {
    return tx.workshopEstimateApproval.create({
      data: {
        tenant_id: approval.tenantId,
        workshop_estimate_version_id: approval.versionId,
        approval_token_id: approval.tokenId,
        channel: EstimateApprovalChannel.LINK,
        decision: decisionOf(input),
        decided_at: now,
        content_sha256: version.snapshot_sha256,
        pdf_sha256: version.pdf_sha256,
        legal_text_version: version.legal_text_version,
        legal_text_sha256: version.legal_text_sha256,
        recipient_email: version.snapshot.customer.email ?? null,
        typed_full_name: input.approve ? input.typedFullName : null,
        legal_blocks_accepted: input.approve,
        b2c_declaration_accepted: input.approve,
        ip_address: truncate(request.ip, MAX_IP_LENGTH),
        user_agent: truncate(request.userAgent, MAX_USER_AGENT_LENGTH),
        accept_language: truncate(
          request.acceptLanguage,
          MAX_ACCEPT_LANGUAGE_LENGTH,
        ),
        amount_quoted_gross: version.total_gross,
      },
      select: { id: true },
    });
  }

  private async recordAuditAndEvent(
    tx: Prisma.TransactionClient,
    approval: ResolvedApproval,
    version: DecidableVersion,
    input: DecisionInput,
    approvalId: string,
    now: Date,
  ): Promise<void> {
    const decision = decisionOf(input);
    await this.audit.recordTenantMutation(
      {
        entityType: 'WorkshopEstimateApproval',
        entityId: approvalId,
        action: AuditLogAction.CREATE,
        actorType: AuditActorType.SYSTEM,
        source: 'public-estimate-approval',
        after: {
          workshop_estimate_version_id: approval.versionId,
          decision,
          channel: EstimateApprovalChannel.LINK,
          decided_at: now.toISOString(),
          content_sha256: version.snapshot_sha256,
        },
      },
      tx,
    );
    await enqueueEstimateDecisionEvent(tx, this.outbox, {
      tenantId: approval.tenantId,
      approvalId,
      versionId: approval.versionId,
      workshopOrderId: version.workshop_order_id,
      decision,
      channel: EstimateApprovalChannel.LINK,
    });
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
    const row = await this.lookup.findByTokenHash(hashApprovalToken(rawToken));
    if (!row) {
      throw this.notFound();
    }
    this.tenantContext.setPublicEstimateApprovalTenant(row.tenant_id);
    if (row.consumed_at !== null || row.invalidated_at !== null) {
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
    // The token expires at the same instant as the version's validity, so a sent version past valid_until is
    // marked EXPIRED here, before the token's own expiry answers.
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
    if (
      version.status === WorkshopEstimateStatus.SUPERSEDED ||
      version.status === WorkshopEstimateStatus.EXPIRED
    ) {
      throw this.unavailable();
    }
    if (row.expires_at.getTime() <= now.getTime()) {
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

  /** A raw token has a fixed shape. Anything else is not found, and it is not counted against a link. */
  private assertWellFormed(rawToken: string): void {
    if (!ESTIMATE_APPROVAL_TOKEN_PATTERN.test(rawToken)) {
      throw this.notFound();
    }
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

type DecisionInput = { approve: boolean; typedFullName: string };

/** The version as the decision needs it, read once the link has been resolved and the version is SENT. */
type DecidableVersion = {
  snapshot: WorkshopEstimateSnapshot;
  snapshot_sha256: string;
  pdf_sha256: string | null;
  legal_text_version: string;
  legal_text_sha256: string;
  total_gross: Prisma.Decimal | null;
  workshop_order_id: string;
};

/** The customer's answer. Approval needs both confirmations and a typed name (ADR-0025 §7). */
function decisionInput(dto: PublicEstimateDecisionDto): DecisionInput {
  const approve = dto.decision === PublicEstimateDecision.APPROVE;
  const typedFullName = dto.typed_full_name?.trim() ?? '';
  if (
    approve &&
    (!dto.legal_blocks_accepted ||
      !dto.b2c_declaration_accepted ||
      typedFullName.length < 2)
  ) {
    throw new UnprocessableEntityException(ESTIMATE_APPROVAL_ERRORS.incomplete);
  }
  return { approve, typedFullName };
}

function decisionOf(input: DecisionInput): EstimateApprovalDecision {
  return input.approve
    ? EstimateApprovalDecision.APPROVED
    : EstimateApprovalDecision.DECLINED;
}
