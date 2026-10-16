import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditLogAction,
  EstimateApprovalDecision,
  Prisma,
  WorkshopEstimateStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { DomainEventStoreService } from '../domain-event-store/domain-event-store.service.js';
import { DomainEventConsumerCloudTasksService } from '../domain-event-consumer/domain-event-consumer-cloud-tasks.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import type { RecordWorkshopEstimateDecisionDto } from './dto/record-workshop-estimate-decision.dto.js';
import type { WorkshopEstimateVersionDetailDto } from './dto/workshop-estimate-response.dto.js';
import {
  assertAmountQuoted,
  assertReactionFits,
  assertVersionDecidable,
  buildAdvisorApprovalData,
  decisionToVersionStatus,
  appendEstimateDecisionDomainEvent,
  resolveAdvisorDecidedAt,
} from './workshop-estimate-decision.helpers.js';
import { wakeEstimateDecidedConsumerAfterCommit } from './wake-estimate-decided-consumer.js';
import { WorkshopEstimateDecidedConsumerService } from './workshop-estimate-decided-consumer.service.js';
import {
  resolveActorUserId,
  resolveEstimateScope,
  type EstimateScope,
} from './workshop-estimate-scope.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';

const DECISION_VERSION_SELECT = {
  id: true,
  status: true,
  sent_at: true,
  valid_until: true,
  total_gross: true,
  snapshot_sha256: true,
  pdf_sha256: true,
  legal_text_version: true,
  legal_text_sha256: true,
  estimate: { select: { workshop_order_id: true } },
} satisfies Prisma.WorkshopEstimateVersionSelect;

type DecisionVersion = Prisma.WorkshopEstimateVersionGetPayload<{
  select: typeof DECISION_VERSION_SELECT;
}>;

/**
 * Advisor-recorded decision on a sent estimate version (AUT-355, ADR-0025 §5 and §7). One transaction moves the
 * version out of SENT with a guarded update, writes the evidence row, writes the audit row and enqueues the domain
 * event. Nothing is sent to the customer here.
 */
@Injectable()
export class WorkshopEstimateApprovalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
    @Inject(DomainEventStoreService)
    private readonly domainEventStore: DomainEventStoreService,
    @Inject(WorkshopEstimateDecidedConsumerService)
    private readonly estimateDecidedConsumer: WorkshopEstimateDecidedConsumerService,
    @Inject(DomainEventConsumerCloudTasksService)
    private readonly estimateDecidedConsumerWakeUps: DomainEventConsumerCloudTasksService,
    @Inject(RequestContextService)
    private readonly requestContext: RequestContextService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(WorkshopEstimateService)
    private readonly estimates: WorkshopEstimateService,
  ) {}

  async recordAdvisorDecision(
    versionId: string,
    dto: RecordWorkshopEstimateDecisionDto,
  ): Promise<WorkshopEstimateVersionDetailDto> {
    const scope = await this.resolveScope();
    const actorUserId = await resolveActorUserId({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      tenantId: scope.tenantId,
    });
    await this.expireIfPastValidity(scope, versionId, new Date());

    await this.prisma
      .$transaction(async (tx) => {
        await this.writeDecision(tx, scope, versionId, dto, actorUserId);
      })
      .catch(mapDecisionWriteError);

    await this.estimateDecidedConsumer.processTenantBatch(scope.tenantId);
    await wakeEstimateDecidedConsumerAfterCommit(
      this.estimateDecidedConsumerWakeUps,
      scope.tenantId,
    );

    return this.estimates.getVersion(versionId);
  }

  private async writeDecision(
    tx: Prisma.TransactionClient,
    scope: EstimateScope,
    versionId: string,
    dto: RecordWorkshopEstimateDecisionDto,
    actorUserId: string,
  ): Promise<void> {
    const now = new Date();
    const version = await this.loadVersion(tx, scope, versionId);
    assertVersionDecidable(version, now);
    assertAmountQuoted(dto.amount_quoted_gross, version.total_gross);
    assertReactionFits(dto.decision, dto.customer_reaction);
    const decidedAt = resolveAdvisorDecidedAt(
      dto.decided_at,
      version.sent_at,
      now,
    );
    const decision = dto.decision;
    const channel = dto.channel;
    await this.moveVersion(tx, scope, versionId, decision);

    const approval = await tx.workshopEstimateApproval.create({
      data: buildAdvisorApprovalData({
        tenantId: scope.tenantId,
        versionId,
        version,
        decision,
        channel,
        decidedAt,
        amountGross: dto.amount_quoted_gross,
        reaction: dto.customer_reaction,
        note: dto.note,
        recordedByUserId: actorUserId,
      }),
      select: { id: true },
    });
    await this.audit.recordTenantMutation(
      {
        entityType: 'WorkshopEstimateApproval',
        entityId: approval.id,
        action: AuditLogAction.CREATE,
        actorUserId,
        source: 'workshop-estimate-approval',
        after: {
          workshop_estimate_version_id: versionId,
          decision,
          channel,
          decided_at: decidedAt.toISOString(),
          amount_quoted_gross: dto.amount_quoted_gross,
          customer_reaction: dto.customer_reaction ?? null,
          content_sha256: version.snapshot_sha256,
          note: dto.note,
          recorded_by_user_id: actorUserId,
        },
      },
      tx,
    );
    await appendEstimateDecisionDomainEvent(tx, {
      tenantId: scope.tenantId,
      siteId: scope.siteId,
      approvalId: approval.id,
      versionId,
      workshopOrderId: version.estimate.workshop_order_id,
      decision,
      decidedAt,
      traceId: this.requestContext.getTraceId() ?? approval.id,
      domainEventStore: this.domainEventStore,
    });
  }

  private async loadVersion(
    tx: Prisma.TransactionClient,
    scope: EstimateScope,
    versionId: string,
  ): Promise<DecisionVersion> {
    const version = await tx.workshopEstimateVersion.findFirst({
      where: {
        id: versionId,
        tenant_id: scope.tenantId,
        estimate: { site_id: scope.siteId },
      },
      select: DECISION_VERSION_SELECT,
    });
    if (!version) {
      throw new NotFoundException('Workshop estimate version not found');
    }
    return version;
  }

  /** Guarded by SENT: a concurrent decision or supersession makes this update match nothing. */
  private async moveVersion(
    tx: Prisma.TransactionClient,
    scope: EstimateScope,
    versionId: string,
    decision: EstimateApprovalDecision,
  ): Promise<void> {
    const moved = await tx.workshopEstimateVersion.updateMany({
      where: {
        id: versionId,
        tenant_id: scope.tenantId,
        status: WorkshopEstimateStatus.SENT,
      },
      data: { status: decisionToVersionStatus(decision) },
    });
    if (moved.count !== 1) {
      throw new ConflictException({
        code: 'ESTIMATE_DECISION_CONFLICT',
        message:
          'The estimate changed while the decision was recorded. Reload it and try again.',
      });
    }
  }

  /** A SENT version past its validity becomes EXPIRED before the decision is refused (ADR-0025 §4). */
  private async expireIfPastValidity(
    scope: EstimateScope,
    versionId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.workshopEstimateVersion.updateMany({
      where: {
        id: versionId,
        tenant_id: scope.tenantId,
        status: WorkshopEstimateStatus.SENT,
        valid_until: { lt: now },
        estimate: { site_id: scope.siteId },
      },
      data: { status: WorkshopEstimateStatus.EXPIRED },
    });
  }

  private resolveScope(): Promise<EstimateScope> {
    return resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
  }
}

/** A racing decision that wins the evidence unique key is a conflict for the second advisor, not a server error. */
function mapDecisionWriteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new ConflictException({
      code: 'ESTIMATE_DECISION_CONFLICT',
      message: 'This estimate version already has a decision.',
    });
  }
  throw error;
}
