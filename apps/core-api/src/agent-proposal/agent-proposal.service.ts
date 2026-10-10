import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgentPolicyTier,
  AgentProposalStatus,
  CustomerType,
  Prisma,
  type AgentProposal,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  loadTenantUserContacts,
  type TenantUserContact,
} from '../common/services/tenant-user-contact.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { assertSupervisorAccess } from './agent-proposal.authorization.js';
import type {
  BatchApplyAgentProposalsDto,
  BatchApplyAgentProposalsResponseDto,
  AgentProposalListResponseDto,
  AgentProposalResponseDto,
  AgentProposalWorkshopOrderSummaryDto,
  CreateAgentProposalDto,
  QueryAgentProposalsDto,
  RejectAgentProposalDto,
  SubmitPendingAgentActionDto,
} from './dto/agent-proposal.dto.js';

const WORKSHOP_ORDER_ID_KEYS = [
  'order_id',
  'orderId',
  'workshop_order_id',
  'workshopOrderId',
] as const;

@Injectable()
export class AgentProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly agentPolicyService: AgentPolicyService,
    private readonly agentActionLog: AgentActionLogService,
    private readonly siteContext: SiteContextService,
    private readonly dryRun: DryRunService,
    private readonly pendingActionExecutors: PendingActionExecutorService,
  ) {}

  async listProposals(
    query: QueryAgentProposalsDto,
  ): Promise<AgentProposalListResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const now = new Date();
    await this.prisma.agentProposal.updateMany({
      where: {
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
        expires_at: { lt: now },
      },
      data: {
        status: AgentProposalStatus.EXPIRED,
      },
    });

    const proposals = await this.prisma.agentProposal.findMany({
      where: {
        tenant_id: tenantId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: query.limit ?? 50,
    });

    const workshopOrderSummaries = await this.loadWorkshopOrderSummaries(
      tenantId,
      proposals,
    );
    const deciders = await loadTenantUserContacts(
      this.prisma,
      tenantId,
      proposals.map((proposal) => proposal.decided_by),
    );
    return {
      data: proposals.map((proposal) =>
        this.toResponseDto(proposal, workshopOrderSummaries, deciders),
      ),
    };
  }

  async getProposalById(id: string): Promise<AgentProposalResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const proposal = await this.prisma.agentProposal.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    if (
      proposal.status === AgentProposalStatus.PENDING &&
      proposal.expires_at < new Date()
    ) {
      await this.prisma.agentProposal.updateMany({
        where: {
          id: proposal.id,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: { status: AgentProposalStatus.EXPIRED },
      });
      proposal.status = AgentProposalStatus.EXPIRED;
    }

    const workshopOrderSummaries = await this.loadWorkshopOrderSummaries(
      tenantId,
      [proposal],
    );
    return this.toResponseDtoWithDecider(
      tenantId,
      proposal,
      workshopOrderSummaries,
    );
  }

  async rejectProposal(
    id: string,
    dto?: RejectAgentProposalDto,
  ): Promise<AgentProposalResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const proposal = await this.prisma.agentProposal.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    if (
      proposal.status === AgentProposalStatus.EXPIRED ||
      (proposal.status === AgentProposalStatus.PENDING &&
        proposal.expires_at < new Date())
    ) {
      if (proposal.status === AgentProposalStatus.PENDING) {
        await this.prisma.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
          },
          data: { status: AgentProposalStatus.EXPIRED },
        });
      }
      throw new UnprocessableEntityException('Proposal has expired');
    }

    if (proposal.status === AgentProposalStatus.REJECTED) {
      return this.toResponseDtoWithDecider(tenantId, proposal);
    }

    if (
      proposal.status === AgentProposalStatus.APPROVED ||
      proposal.status === AgentProposalStatus.EXECUTED
    ) {
      throw new ConflictException(
        `Proposal is already ${proposal.status.toLowerCase()}`,
      );
    }

    if (proposal.status === AgentProposalStatus.FAILED) {
      throw new ConflictException('Proposal has failed and cannot be rejected');
    }

    const now = new Date();
    const rejectedProposal = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.agentProposal.updateMany({
        where: {
          id: proposal.id,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
          expires_at: { gt: now },
        },
        data: {
          status: AgentProposalStatus.REJECTED,
          decided_by: currentUser.id,
          decided_at: now,
          reason: dto?.reason ?? null,
        },
      });
      if (updated.count === 0) return null;

      await this.agentActionLog.recordInTransaction(
        {
          traceId: proposal.trace_id,
          actorType: 'USER',
          agentId:
            proposal.created_by_agent ??
            this.getOriginatingAgentId(proposal.payload_json),
          onBehalfOfUserId: currentUser.id,
          actionType: proposal.action_type,
          tier: 'PROPOSE',
          status: 'REJECTED',
          inputSummary: { proposalId: proposal.id, reason: dto?.reason },
          resultSummary: { rejectedBy: currentUser.id, reason: dto?.reason },
        },
        tx,
      );

      return tx.agentProposal.findFirst({
        where: { id: proposal.id, tenant_id: tenantId },
      });
    });
    if (rejectedProposal) {
      return this.toResponseDtoWithDecider(tenantId, rejectedProposal);
    }

    const reloaded = await this.prisma.agentProposal.findFirst({
      where: { id: proposal.id, tenant_id: tenantId },
    });
    if (!reloaded) throw new NotFoundException('Proposal not found');
    if (
      reloaded.status === AgentProposalStatus.EXPIRED ||
      (reloaded.status === AgentProposalStatus.PENDING &&
        reloaded.expires_at <= now)
    ) {
      if (reloaded.status === AgentProposalStatus.PENDING) {
        await this.prisma.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
          },
          data: { status: AgentProposalStatus.EXPIRED },
        });
      }
      throw new UnprocessableEntityException('Proposal has expired');
    }
    if (reloaded.status === AgentProposalStatus.REJECTED) {
      return this.toResponseDtoWithDecider(tenantId, reloaded);
    }
    throw new ConflictException(
      `Proposal state conflict: current status is ${reloaded.status}`,
    );
  }

  async approveProposal(id: string): Promise<AgentProposalResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const proposal = await this.prisma.agentProposal.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    if (
      proposal.status === AgentProposalStatus.EXPIRED ||
      (proposal.status === AgentProposalStatus.PENDING &&
        proposal.expires_at < new Date())
    ) {
      if (proposal.status === AgentProposalStatus.PENDING) {
        await this.prisma.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
          },
          data: { status: AgentProposalStatus.EXPIRED },
        });
      }
      throw new UnprocessableEntityException('Proposal has expired');
    }

    if (
      proposal.status === AgentProposalStatus.APPROVED ||
      proposal.status === AgentProposalStatus.EXECUTED
    ) {
      return this.toResponseDtoWithDecider(tenantId, proposal);
    }

    if (
      proposal.status === AgentProposalStatus.REJECTED ||
      proposal.status === AgentProposalStatus.FAILED
    ) {
      throw new ConflictException(
        `Proposal is in status ${proposal.status} and cannot be approved`,
      );
    }

    if (proposal.tier === AgentPolicyTier.HUMAN_ONLY) {
      throw new UnprocessableEntityException(
        'HUMAN_ONLY proposals must be performed manually',
      );
    }

    let executor: ReturnType<PendingActionExecutorService['resolve']>;
    try {
      executor = this.pendingActionExecutors.resolve(proposal.action_type);
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        const failed = await tx.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
          },
          data: {
            status: AgentProposalStatus.FAILED,
            reason:
              error instanceof Error ? error.message : 'Unsupported action',
          },
        });
        if (failed.count === 0) return;
        await this.agentActionLog.recordInTransaction(
          {
            traceId: proposal.trace_id,
            actorType: 'USER',
            agentId:
              proposal.created_by_agent ??
              this.getOriginatingAgentId(proposal.payload_json),
            onBehalfOfUserId: currentUser.id,
            actionType: proposal.action_type,
            tier: 'PROPOSE',
            status: 'FAILED',
            inputSummary: { proposalId: proposal.id },
            resultSummary: {
              error:
                error instanceof Error ? error.message : 'Unsupported action',
            },
          },
          tx,
        );
      });
      throw error;
    }
    const policyContext =
      proposal.action_type === 'workshop_order.add_line'
        ? this.extractPolicyContext(proposal.payload_json, proposal.action_type)
        : await executor.buildPolicyContext(proposal.payload_json);
    const evalResult = await this.agentPolicyService.evaluate(
      {
        action_type: proposal.action_type,
        context: policyContext,
      },
      { skipAdminCheck: true },
    );

    if (evalResult.tier === AgentPolicyTier.HUMAN_ONLY) {
      throw new UnprocessableEntityException(
        'Action requires human execution or exceeds policy limits: ' +
          evalResult.reasons.join(', '),
      );
    }

    if (proposal.action_type === 'workshop_order.create') {
      const preview = proposal.preview_json;
      const executionContext =
        preview && typeof preview === 'object' && !Array.isArray(preview)
          ? (preview as Record<string, unknown>).execution_context
          : undefined;
      const intendedSiteId =
        executionContext &&
        typeof executionContext === 'object' &&
        !Array.isArray(executionContext) &&
        typeof (executionContext as Record<string, unknown>).site_id ===
          'string'
          ? (executionContext as Record<string, string>).site_id
          : undefined;
      if (
        !intendedSiteId ||
        (await this.siteContext.getSiteId()) !== intendedSiteId
      ) {
        throw new UnprocessableEntityException(
          'Select the site where this action was simulated before applying it',
        );
      }
    }

    // Resolved before the try block: once the action is claimed, the catch below
    // treats any error as an execution failure, and a read must not do that.
    const deciderContacts = await loadTenantUserContacts(
      this.prisma,
      tenantId,
      [currentUser.id],
    );
    const now = new Date();
    let claimed = false;
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
            expires_at: { gt: now },
          },
          data: {
            status: AgentProposalStatus.APPROVED,
            decided_by: currentUser.id,
            decided_at: now,
          },
        });
        if (updated.count === 0) return { claimed: false as const };
        claimed = true;

        await this.agentActionLog.recordInTransaction(
          {
            traceId: proposal.trace_id,
            actorType: 'USER',
            agentId:
              proposal.created_by_agent ??
              this.getOriginatingAgentId(proposal.payload_json),
            onBehalfOfUserId: currentUser.id,
            actionType: proposal.action_type,
            tier: 'PROPOSE',
            status: 'EXECUTED',
            inputSummary: {
              proposalId: proposal.id,
              payload: proposal.payload_json,
            },
            resultSummary: (result?: Record<string, unknown>) => ({
              approvedBy: currentUser.id,
              executed: true,
              entityId: result?.entityId,
            }),
          },
          tx,
          () =>
            DryRunStorage.run({ isDryRun: false, tx }, () =>
              executor.execute(
                proposal.payload_json,
                proposal.action_type === 'workshop_order.create'
                  ? {
                      site_id: (
                        (proposal.preview_json as Record<string, unknown>)
                          .execution_context as Record<string, unknown>
                      ).site_id,
                    }
                  : undefined,
              ),
            ),
        );

        await tx.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.APPROVED,
          },
          data: { status: AgentProposalStatus.EXECUTED },
        });
        const executedProposal = await tx.agentProposal.findFirst({
          where: { id: proposal.id, tenant_id: tenantId },
        });
        if (!executedProposal) {
          throw new NotFoundException('Proposal not found');
        }
        return { claimed: true as const, proposal: executedProposal };
      });

      if (outcome.claimed) {
        return this.toResponseDto(outcome.proposal, new Map(), deciderContacts);
      }

      const reloaded = await this.prisma.agentProposal.findFirst({
        where: { id: proposal.id, tenant_id: tenantId },
      });
      if (!reloaded) throw new NotFoundException('Proposal not found');
      if (
        reloaded.status === AgentProposalStatus.PENDING &&
        reloaded.expires_at <= now
      ) {
        await this.prisma.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
          },
          data: { status: AgentProposalStatus.EXPIRED },
        });
        throw new UnprocessableEntityException('Proposal has expired');
      }
      if (
        reloaded.status === AgentProposalStatus.APPROVED ||
        reloaded.status === AgentProposalStatus.EXECUTED
      ) {
        return this.toResponseDtoWithDecider(tenantId, reloaded);
      }
      throw new ConflictException(
        `Proposal state conflict: current status is ${reloaded.status}`,
      );
    } catch (error) {
      if (claimed) {
        try {
          await this.prisma.$transaction(async (tx) => {
            const failed = await tx.agentProposal.updateMany({
              where: {
                id: proposal.id,
                tenant_id: tenantId,
                status: AgentProposalStatus.PENDING,
              },
              data: {
                status: AgentProposalStatus.FAILED,
                reason:
                  error instanceof Error ? error.message : 'Execution failed',
              },
            });
            if (failed.count === 0) return;
            await this.agentActionLog.recordInTransaction(
              {
                traceId: proposal.trace_id,
                actorType: 'USER',
                agentId:
                  proposal.created_by_agent ??
                  this.getOriginatingAgentId(proposal.payload_json),
                onBehalfOfUserId: currentUser.id,
                actionType: proposal.action_type,
                tier: 'PROPOSE',
                status: 'FAILED',
                inputSummary: { proposalId: proposal.id },
                resultSummary: {
                  approvedBy: currentUser.id,
                  error:
                    error instanceof Error ? error.message : 'Execution failed',
                },
              },
              tx,
            );
          });
        } catch {
          // The failed state remains recoverable as PENDING if audit persistence is unavailable.
        }
      }
      throw error;
    }
  }

  async batchApplyProposals(
    dto: BatchApplyAgentProposalsDto,
  ): Promise<BatchApplyAgentProposalsResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const results = await Promise.all(
      dto.ids.map(async (id) => {
        try {
          const proposal = await this.approveProposal(id);
          return { id, status: 'applied' as const, proposal };
        } catch (error) {
          return {
            id,
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'Apply failed',
          };
        }
      }),
    );
    return { results };
  }

  async createProposal(
    dto: CreateAgentProposalDto,
  ): Promise<AgentProposalResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const traceId = dto.trace_id ?? randomUUID();

    const created = await this.prisma.agentProposal.create({
      data: {
        tenant_id: tenantId,
        trace_id: traceId,
        action_type: dto.action_type,
        payload_json: dto.payload_json as Prisma.InputJsonValue,
        preview_json: dto.preview_json
          ? (dto.preview_json as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        tier: dto.tier ?? AgentPolicyTier.PROPOSE,
        status: AgentProposalStatus.PENDING,
      },
    });

    return this.toResponseDto(created);
  }

  async persistPendingAction(input: {
    action_type: string;
    payload_json: unknown;
    preview_json: unknown;
    tier: AgentPolicyTier;
    trace_id: string;
    created_by_agent?: string;
  }): Promise<AgentProposalResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const created = await this.prisma.agentProposal.create({
      data: {
        tenant_id: tenantId,
        trace_id: input.trace_id,
        action_type: input.action_type,
        payload_json: input.payload_json as Prisma.InputJsonValue,
        preview_json: input.preview_json as Prisma.InputJsonValue,
        tier: input.tier,
        status: AgentProposalStatus.PENDING,
        created_by_agent: input.created_by_agent ?? null,
      },
    });
    return this.toResponseDto(created);
  }

  async submitPendingAction(
    dto: SubmitPendingAgentActionDto,
  ): Promise<AgentProposalResponseDto> {
    const actionType = dto.action_type;
    const executor = this.pendingActionExecutors.resolve(actionType);
    const policyContext =
      actionType === 'workshop_order.add_line'
        ? this.extractPolicyContext(dto.payload_json, actionType)
        : await executor.buildPolicyContext(dto.payload_json);
    const evaluation = await this.agentPolicyService.evaluate(
      { action_type: actionType, context: policyContext },
      { skipAdminCheck: true },
    );
    if (evaluation.tier !== AgentPolicyTier.PROPOSE) {
      throw new UnprocessableEntityException(
        'Only actions currently evaluated as PROPOSE can be submitted for approval',
      );
    }

    const intendedSiteId =
      actionType === 'workshop_order.create'
        ? await this.siteContext.getSiteId()
        : undefined;
    const executionContext = intendedSiteId
      ? { site_id: intendedSiteId }
      : undefined;
    const simulation = await this.dryRun.executeInRollbackTransaction(() =>
      executor.execute(dto.payload_json, executionContext),
    );
    if (
      intendedSiteId &&
      (await this.siteContext.getSiteId()) !== intendedSiteId
    ) {
      throw new UnprocessableEntityException(
        'The active site changed while the pending action was simulated',
      );
    }
    const traceId = randomUUID();
    await this.agentActionLog.record({
      traceId,
      actorType: 'USER',
      onBehalfOfUserId: this.tenantContext.getAuthenticatedUser()?.userId,
      actionType,
      tier: AgentPolicyTier.PROPOSE,
      status: 'PROPOSED',
      inputSummary: { payload: dto.payload_json },
      resultSummary: { would_change: simulation.wouldChange },
    });
    return this.persistPendingAction({
      action_type: actionType,
      payload_json: dto.payload_json,
      preview_json: {
        result: simulation.result,
        would_change: simulation.wouldChange,
        ...(intendedSiteId
          ? { execution_context: { site_id: intendedSiteId } }
          : {}),
      },
      tier: AgentPolicyTier.PROPOSE,
      trace_id: traceId,
    });
  }

  resolveLineItemFinancials(record: Record<string, unknown>): {
    unitPrice: number;
    totalAmount: number;
    quantity: number;
  } {
    return resolveLineItemFinancials(record);
  }

  private extractPolicyContext(
    payload: unknown,
    actionType?: string,
  ): AgentPolicyEvaluateContext {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    const record = payload as Record<string, unknown>;
    const policyRecord =
      record.line_item &&
      typeof record.line_item === 'object' &&
      !Array.isArray(record.line_item)
        ? { ...record, ...(record.line_item as Record<string, unknown>) }
        : record;
    const context: AgentPolicyEvaluateContext = {};

    if (
      actionType === 'workshop_order.add_line' ||
      actionType === 'workshop_order.propose_line'
    ) {
      const financials = resolveLineItemFinancials(policyRecord);
      context.amount_eur = financials.totalAmount;
    } else {
      let amountEur: number | undefined;
      if (
        typeof record.amount_eur === 'number' &&
        Number.isFinite(record.amount_eur)
      ) {
        amountEur = record.amount_eur;
      } else if (
        typeof record.amountEur === 'number' &&
        Number.isFinite(record.amountEur)
      ) {
        amountEur = record.amountEur;
      } else if (
        typeof record.amount === 'number' &&
        Number.isFinite(record.amount)
      ) {
        amountEur = record.amount;
      } else if (
        typeof record.amount_cents === 'number' &&
        Number.isFinite(record.amount_cents)
      ) {
        amountEur = record.amount_cents / 100;
      } else if (
        typeof record.amountCents === 'number' &&
        Number.isFinite(record.amountCents)
      ) {
        amountEur = record.amountCents / 100;
      }

      if (typeof amountEur === 'number') {
        if (amountEur < 0) {
          throw new BadRequestException('Amount cannot be negative');
        }
        context.amount_eur = amountEur;
      }
    }

    const customerFacing =
      typeof record.customer_facing === 'boolean'
        ? record.customer_facing
        : typeof record.customerFacing === 'boolean'
          ? record.customerFacing
          : undefined;
    if (typeof customerFacing === 'boolean') {
      context.customer_facing = customerFacing;
    }

    const reversible =
      typeof record.reversible === 'boolean' ? record.reversible : undefined;
    if (typeof reversible === 'boolean') {
      context.reversible = reversible;
    }

    const affectsLegal =
      typeof record.affects_legal_document === 'boolean'
        ? record.affects_legal_document
        : typeof record.affectsLegalDocument === 'boolean'
          ? record.affectsLegalDocument
          : undefined;
    if (typeof affectsLegal === 'boolean') {
      context.affects_legal_document = affectsLegal;
    }

    if (
      record.context &&
      typeof record.context === 'object' &&
      !Array.isArray(record.context)
    ) {
      const nested = this.extractPolicyContext(record.context, actionType);
      return { ...nested, ...context };
    }

    return context;
  }

  private getOriginatingAgentId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined;
    }
    const record = payload as Record<string, unknown>;
    const agentId = record.agent_id ?? record.agentId;
    return typeof agentId === 'string' && agentId.length > 0
      ? agentId
      : undefined;
  }

  private buildEffectiveSummary(
    actionType: string,
    payload: Record<string, unknown>,
  ): {
    target_type: string | null;
    target_id: string | null;
    amount_eur: number | null;
  } {
    const firstString = (keys: string[]) => {
      for (const key of keys) {
        if (typeof payload[key] === 'string') return payload[key];
      }
      return null;
    };
    const targetType =
      actionType === 'customer.update'
        ? 'Customer'
        : actionType === 'workshop_order.add_line' ||
            actionType === 'workshop_order.propose_line'
          ? 'WorkshopOrder'
          : firstString(['entity_type', 'entityType']);
    const targetId =
      actionType === 'customer.update'
        ? firstString(['customer_id', 'customerId'])
        : actionType === 'workshop_order.add_line' ||
            actionType === 'workshop_order.propose_line'
          ? firstString([...WORKSHOP_ORDER_ID_KEYS])
          : firstString(['entity_id', 'entityId']);

    let amountEur: number | null = null;
    try {
      const amount = this.extractPolicyContext(payload, actionType).amount_eur;
      if (typeof amount === 'number') amountEur = amount;
    } catch {
      amountEur = null;
    }

    return {
      target_type: targetType,
      target_id: targetId,
      amount_eur: amountEur,
    };
  }

  /**
   * Read-only display context for workshop order proposals. Orders are
   * site-owned, so only orders in sites the caller may operate on are loaded.
   * Anything else resolves to null and the card shows plain fallbacks.
   */
  private async loadWorkshopOrderSummaries(
    tenantId: string,
    proposals: AgentProposal[],
  ): Promise<Map<string, AgentProposalWorkshopOrderSummaryDto>> {
    const summaries = new Map<string, AgentProposalWorkshopOrderSummaryDto>();
    const orderIds = [
      ...new Set(
        proposals
          .map((proposal) =>
            this.resolveWorkshopOrderId(
              proposal.action_type,
              (proposal.payload_json ?? {}) as Record<string, unknown>,
            ),
          )
          .filter((orderId): orderId is string => orderId !== null),
      ),
    ];
    if (orderIds.length === 0) {
      return summaries;
    }

    const siteIds = await this.siteContext.listAuthorizedSiteIds();
    if (siteIds.length === 0) {
      return summaries;
    }

    const orders = await this.prisma.workshopOrder.findMany({
      where: {
        tenant_id: tenantId,
        site_id: { in: siteIds },
        id: { in: orderIds },
      },
      select: {
        id: true,
        order_number: true,
        customer: {
          select: {
            type: true,
            company_name: true,
            first_name: true,
            last_name: true,
          },
        },
        vehicle: {
          select: { plate: true, year: true, make: true, model: true },
        },
      },
    });

    for (const order of orders) {
      const vehicleDescription = [
        String(order.vehicle.year),
        order.vehicle.make,
        order.vehicle.model,
      ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' ');
      summaries.set(order.id, {
        id: order.id,
        order_number: order.order_number.trim() || null,
        customer_name: formatCustomerName(order.customer),
        vehicle_registration: order.vehicle.plate?.trim() || null,
        vehicle_description: vehicleDescription || null,
      });
    }
    return summaries;
  }

  private resolveWorkshopOrderId(
    actionType: string,
    payload: Record<string, unknown>,
  ): string | null {
    if (
      actionType !== 'workshop_order.add_line' &&
      actionType !== 'workshop_order.propose_line'
    ) {
      return null;
    }
    for (const key of WORKSHOP_ORDER_ID_KEYS) {
      const value = payload[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return null;
  }

  /**
   * Single-proposal response that also resolves the decider's name and email.
   * Lists batch that lookup in one query instead of calling this per row.
   */
  private async toResponseDtoWithDecider(
    tenantId: string,
    proposal: AgentProposal,
    workshopOrderSummaries: Map<
      string,
      AgentProposalWorkshopOrderSummaryDto
    > = new Map(),
  ): Promise<AgentProposalResponseDto> {
    const deciders = await loadTenantUserContacts(this.prisma, tenantId, [
      proposal.decided_by,
    ]);
    return this.toResponseDto(proposal, workshopOrderSummaries, deciders);
  }

  private toResponseDto(
    proposal: AgentProposal,
    workshopOrderSummaries: Map<
      string,
      AgentProposalWorkshopOrderSummaryDto
    > = new Map(),
    deciders: Map<string, TenantUserContact> = new Map(),
  ): AgentProposalResponseDto {
    const workshopOrderId = this.resolveWorkshopOrderId(
      proposal.action_type,
      (proposal.payload_json ?? {}) as Record<string, unknown>,
    );
    const decider = proposal.decided_by
      ? deciders.get(proposal.decided_by)
      : undefined;
    return {
      id: proposal.id,
      tenant_id: proposal.tenant_id,
      trace_id: proposal.trace_id,
      action_type: proposal.action_type,
      tier: proposal.tier,
      status: proposal.status,
      payload_json: (proposal.payload_json ?? {}) as Record<string, unknown>,
      effective_summary: this.buildEffectiveSummary(
        proposal.action_type,
        (proposal.payload_json ?? {}) as Record<string, unknown>,
      ),
      workshop_order_summary: workshopOrderId
        ? (workshopOrderSummaries.get(workshopOrderId) ?? null)
        : null,
      preview_json: (proposal.preview_json ?? null) as Record<
        string,
        unknown
      > | null,
      created_by_agent: proposal.created_by_agent,
      decided_by: proposal.decided_by,
      decided_by_name: decider?.name ?? null,
      decided_by_email: decider?.email ?? null,
      decided_at: proposal.decided_at
        ? proposal.decided_at.toISOString()
        : null,
      reason: proposal.reason,
      expires_at: proposal.expires_at.toISOString(),
      created_at: proposal.createdAt.toISOString(),
      updated_at: proposal.updatedAt.toISOString(),
    };
  }
}

export interface LineItemFinancials {
  unitPrice: number;
  totalAmount: number;
  quantity: number;
}

export function resolveLineItemFinancials(
  record: Record<string, unknown>,
): LineItemFinancials {
  let quantity = 1;
  if (record.quantity !== undefined) {
    if (
      typeof record.quantity !== 'number' ||
      !Number.isFinite(record.quantity) ||
      record.quantity <= 0
    ) {
      throw new BadRequestException(
        'Line item quantity must be a positive number',
      );
    }
    quantity = record.quantity;
  }

  let unitPriceFromPayload: number | undefined;
  if (record.unit_price !== undefined) {
    if (
      typeof record.unit_price !== 'number' ||
      !Number.isFinite(record.unit_price)
    ) {
      throw new BadRequestException(
        'Line item unit_price must be a valid number',
      );
    }
    if (record.unit_price < 0) {
      throw new BadRequestException('Line item unit_price cannot be negative');
    }
    unitPriceFromPayload = record.unit_price;
  } else if (record.unitPrice !== undefined) {
    if (
      typeof record.unitPrice !== 'number' ||
      !Number.isFinite(record.unitPrice)
    ) {
      throw new BadRequestException(
        'Line item unit_price must be a valid number',
      );
    }
    if (record.unitPrice < 0) {
      throw new BadRequestException('Line item unit_price cannot be negative');
    }
    unitPriceFromPayload = record.unitPrice;
  } else if (record.unit_price_cents !== undefined) {
    if (
      typeof record.unit_price_cents !== 'number' ||
      !Number.isFinite(record.unit_price_cents)
    ) {
      throw new BadRequestException(
        'Line item unit_price must be a valid number',
      );
    }
    if (record.unit_price_cents < 0) {
      throw new BadRequestException('Line item unit_price cannot be negative');
    }
    unitPriceFromPayload = record.unit_price_cents / 100;
  } else if (record.unitPriceCents !== undefined) {
    if (
      typeof record.unitPriceCents !== 'number' ||
      !Number.isFinite(record.unitPriceCents)
    ) {
      throw new BadRequestException(
        'Line item unit_price must be a valid number',
      );
    }
    if (record.unitPriceCents < 0) {
      throw new BadRequestException('Line item unit_price cannot be negative');
    }
    unitPriceFromPayload = record.unitPriceCents / 100;
  }

  let totalAmountFromPayload: number | undefined;
  if (record.amount_eur !== undefined) {
    if (
      typeof record.amount_eur !== 'number' ||
      !Number.isFinite(record.amount_eur)
    ) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amount_eur < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
    totalAmountFromPayload = record.amount_eur;
  } else if (record.amountEur !== undefined) {
    if (
      typeof record.amountEur !== 'number' ||
      !Number.isFinite(record.amountEur)
    ) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amountEur < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
    totalAmountFromPayload = record.amountEur;
  } else if (record.amount !== undefined) {
    if (typeof record.amount !== 'number' || !Number.isFinite(record.amount)) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amount < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
    totalAmountFromPayload = record.amount;
  } else if (record.amount_cents !== undefined) {
    if (
      typeof record.amount_cents !== 'number' ||
      !Number.isFinite(record.amount_cents)
    ) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amount_cents < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
    totalAmountFromPayload = record.amount_cents / 100;
  } else if (record.amountCents !== undefined) {
    if (
      typeof record.amountCents !== 'number' ||
      !Number.isFinite(record.amountCents)
    ) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amountCents < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
    totalAmountFromPayload = record.amountCents / 100;
  }

  if (
    unitPriceFromPayload !== undefined &&
    totalAmountFromPayload !== undefined
  ) {
    const expectedTotal = unitPriceFromPayload * quantity;
    if (Math.abs(expectedTotal - totalAmountFromPayload) > 0.01) {
      throw new BadRequestException(
        `Payload amount (${totalAmountFromPayload}) contradicts unit_price (${unitPriceFromPayload}) * quantity (${quantity}) = ${expectedTotal}`,
      );
    }
    return {
      unitPrice: unitPriceFromPayload,
      totalAmount: totalAmountFromPayload,
      quantity,
    };
  }

  if (unitPriceFromPayload !== undefined) {
    return {
      unitPrice: unitPriceFromPayload,
      totalAmount: unitPriceFromPayload * quantity,
      quantity,
    };
  }

  if (totalAmountFromPayload !== undefined) {
    return {
      unitPrice: totalAmountFromPayload / quantity,
      totalAmount: totalAmountFromPayload,
      quantity,
    };
  }

  return {
    unitPrice: 0,
    totalAmount: 0,
    quantity,
  };
}

function formatCustomerName(
  customer: {
    type: CustomerType;
    company_name: string | null;
    first_name: string;
    last_name: string;
  } | null,
): string | null {
  if (!customer) {
    return null;
  }
  const companyName = customer.company_name?.trim();
  if (customer.type === CustomerType.COMPANY && companyName) {
    return companyName;
  }
  return `${customer.first_name} ${customer.last_name}`.trim() || null;
}
