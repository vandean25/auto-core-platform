import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgentPolicyTier,
  AgentProposalStatus,
  type AgentProposal,
} from '@prisma/client';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  loadTenantUserContacts,
  type TenantUserContact,
} from '../common/services/tenant-user-contact.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PendingActionExecutorService,
  type PendingActionExecutor,
} from '../pending-action-executor/pending-action-executor.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { assertSupervisorAccess } from './agent-proposal.authorization.js';
import {
  getOriginatingAgentId,
  readExecutionSiteId,
} from './agent-proposal-payload.js';
import { AgentProposalPolicyEvaluator } from './agent-proposal-policy-evaluator.service.js';
import { AgentProposalReadService } from './agent-proposal-read.service.js';
import { toAgentProposalResponseDto } from './agent-proposal-response.mapper.js';
import type {
  AgentProposalResponseDto,
  RejectAgentProposalDto,
} from './dto/agent-proposal.dto.js';

/** Human decisions on pending proposals: reject, and approve (which executes the stored payload). */
@Injectable()
export class AgentProposalDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly agentActionLog: AgentActionLogService,
    private readonly siteContext: SiteContextService,
    private readonly pendingActionExecutors: PendingActionExecutorService,
    private readonly policyEvaluator: AgentProposalPolicyEvaluator,
    private readonly reads: AgentProposalReadService,
  ) {}

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

    const proposal = await this.findProposalOrThrow(id, tenantId);
    if (
      proposal.status === AgentProposalStatus.EXPIRED ||
      (proposal.status === AgentProposalStatus.PENDING &&
        proposal.expires_at < new Date())
    ) {
      await this.expireIfPending(proposal, tenantId);
      throw new UnprocessableEntityException('Proposal has expired');
    }

    if (proposal.status === AgentProposalStatus.REJECTED) {
      return this.reads.toResponseWithDecider(tenantId, proposal);
    }
    this.assertRejectable(proposal);

    const now = new Date();
    const rejectedProposal = await this.recordRejection(
      proposal,
      tenantId,
      currentUser.id,
      dto,
      now,
    );
    if (rejectedProposal) {
      return this.reads.toResponseWithDecider(tenantId, rejectedProposal);
    }
    return this.resolveUnclaimedRejection(proposal, tenantId, now);
  }

  private assertRejectable(proposal: AgentProposal): void {
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
  }

  /** Claims a PENDING proposal as REJECTED. Returns null when another request decided it first. */
  private async recordRejection(
    proposal: AgentProposal,
    tenantId: string,
    deciderId: string,
    dto: RejectAgentProposalDto | undefined,
    now: Date,
  ): Promise<AgentProposal | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.agentProposal.updateMany({
        where: {
          id: proposal.id,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
          expires_at: { gt: now },
        },
        data: {
          status: AgentProposalStatus.REJECTED,
          decided_by: deciderId,
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
            getOriginatingAgentId(proposal.payload_json),
          onBehalfOfUserId: deciderId,
          actionType: proposal.action_type,
          tier: 'PROPOSE',
          status: 'REJECTED',
          inputSummary: { proposalId: proposal.id, reason: dto?.reason },
          resultSummary: { rejectedBy: deciderId, reason: dto?.reason },
        },
        tx,
      );

      return tx.agentProposal.findFirst({
        where: { id: proposal.id, tenant_id: tenantId },
      });
    });
  }

  /** Another request decided the proposal first: report what it became. */
  private async resolveUnclaimedRejection(
    proposal: AgentProposal,
    tenantId: string,
    now: Date,
  ): Promise<AgentProposalResponseDto> {
    const reloaded = await this.prisma.agentProposal.findFirst({
      where: { id: proposal.id, tenant_id: tenantId },
    });
    if (!reloaded) throw new NotFoundException('Proposal not found');
    if (
      reloaded.status === AgentProposalStatus.EXPIRED ||
      (reloaded.status === AgentProposalStatus.PENDING &&
        reloaded.expires_at <= now)
    ) {
      await this.expireIfPending(reloaded, tenantId);
      throw new UnprocessableEntityException('Proposal has expired');
    }
    if (reloaded.status === AgentProposalStatus.REJECTED) {
      return this.reads.toResponseWithDecider(tenantId, reloaded);
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

    const proposal = await this.findProposalOrThrow(id, tenantId);
    if (
      proposal.status === AgentProposalStatus.EXPIRED ||
      (proposal.status === AgentProposalStatus.PENDING &&
        proposal.expires_at < new Date())
    ) {
      await this.expireIfPending(proposal, tenantId);
      throw new UnprocessableEntityException('Proposal has expired');
    }

    if (
      proposal.status === AgentProposalStatus.APPROVED ||
      proposal.status === AgentProposalStatus.EXECUTED
    ) {
      return this.reads.toResponseWithDecider(tenantId, proposal);
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

    const executor = await this.resolveExecutorOrFail(
      proposal,
      tenantId,
      currentUser.id,
    );
    await this.assertPolicyAllowsApproval(proposal, executor);
    await this.assertSiteMatchesSimulation(proposal);

    // Resolved before the claim: once the action is claimed, the catch in
    // claimAndExecute treats any error as an execution failure, and a read must not do that.
    const deciderContacts = await loadTenantUserContacts(
      this.prisma,
      tenantId,
      [currentUser.id],
    );
    return this.claimAndExecute(
      proposal,
      tenantId,
      currentUser.id,
      executor,
      deciderContacts,
    );
  }

  private async findProposalOrThrow(
    id: string,
    tenantId: string,
  ): Promise<AgentProposal> {
    const proposal = await this.prisma.agentProposal.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }
    return proposal;
  }

  private async expireIfPending(
    proposal: AgentProposal,
    tenantId: string,
  ): Promise<void> {
    if (proposal.status !== AgentProposalStatus.PENDING) return;
    await this.prisma.agentProposal.updateMany({
      where: {
        id: proposal.id,
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
      },
      data: { status: AgentProposalStatus.EXPIRED },
    });
  }

  /** Resolves the executor for the action; an unsupported action is recorded as FAILED first. */
  private async resolveExecutorOrFail(
    proposal: AgentProposal,
    tenantId: string,
    approverId: string,
  ): Promise<PendingActionExecutor> {
    try {
      return this.pendingActionExecutors.resolve(proposal.action_type);
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
              getOriginatingAgentId(proposal.payload_json),
            onBehalfOfUserId: approverId,
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
  }

  private async assertPolicyAllowsApproval(
    proposal: AgentProposal,
    executor: PendingActionExecutor,
  ): Promise<void> {
    const evaluation = await this.policyEvaluator.evaluate(
      proposal.action_type,
      proposal.payload_json,
      executor,
    );
    if (evaluation.tier === AgentPolicyTier.HUMAN_ONLY) {
      throw new UnprocessableEntityException(
        'Action requires human execution or exceeds policy limits: ' +
          evaluation.reasons.join(', '),
      );
    }
  }

  /** Workshop-order creation only applies in the site where it was simulated. */
  private async assertSiteMatchesSimulation(
    proposal: AgentProposal,
  ): Promise<void> {
    if (
      proposal.action_type !== 'workshop_order.create' &&
      proposal.action_type !== 'registration_intake.apply' &&
      proposal.action_type !== 'workshop.booking_package' &&
      proposal.action_type !== 'purchase_order.propose_draft' &&
      proposal.action_type !== 'workshop_order.complete' &&
      proposal.action_type !== 'workshop_order.mechanic_finding'
    ) {
      return;
    }
    const intendedSiteId = readExecutionSiteId(proposal.preview_json);
    if (
      !intendedSiteId ||
      (await this.siteContext.getSiteId()) !== intendedSiteId
    ) {
      throw new UnprocessableEntityException(
        'Select the site where this action was simulated before applying it',
      );
    }
  }

  /**
   * Claims the PENDING proposal, runs its payload and marks it EXECUTED in one
   * transaction. If another request claimed it first, the reloaded state decides the response.
   */
  private async claimAndExecute(
    proposal: AgentProposal,
    tenantId: string,
    approverId: string,
    executor: PendingActionExecutor,
    deciderContacts: Map<string, TenantUserContact>,
  ): Promise<AgentProposalResponseDto> {
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
            decided_by: approverId,
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
              getOriginatingAgentId(proposal.payload_json),
            onBehalfOfUserId: approverId,
            actionType: proposal.action_type,
            tier: 'PROPOSE',
            status: 'EXECUTED',
            inputSummary: {
              proposalId: proposal.id,
              payload: proposal.payload_json,
            },
            resultSummary: (result?: Record<string, unknown>) => ({
              approvedBy: approverId,
              executed: true,
              entityId: result?.entityId,
            }),
          },
          tx,
          () =>
            DryRunStorage.run({ isDryRun: false, tx }, () =>
              executor.execute(
                proposal.payload_json,
                proposal.action_type === 'workshop_order.create' ||
                  proposal.action_type === 'registration_intake.apply' ||
                  proposal.action_type === 'workshop.booking_package' ||
                  proposal.action_type === 'purchase_order.propose_draft' ||
                  proposal.action_type === 'workshop_order.complete'
                  ? { site_id: readExecutionSiteId(proposal.preview_json) }
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
        return toAgentProposalResponseDto(
          outcome.proposal,
          new Map(),
          deciderContacts,
        );
      }
      return await this.resolveUnclaimedApproval(proposal, tenantId, now);
    } catch (error) {
      if (claimed) {
        await this.markExecutionFailed(proposal, tenantId, approverId, error);
      }
      throw error;
    }
  }

  /** Another request won the claim: report what the proposal became. */
  private async resolveUnclaimedApproval(
    proposal: AgentProposal,
    tenantId: string,
    now: Date,
  ): Promise<AgentProposalResponseDto> {
    const reloaded = await this.prisma.agentProposal.findFirst({
      where: { id: proposal.id, tenant_id: tenantId },
    });
    if (!reloaded) throw new NotFoundException('Proposal not found');
    if (
      reloaded.status === AgentProposalStatus.PENDING &&
      reloaded.expires_at <= now
    ) {
      await this.expireIfPending(reloaded, tenantId);
      throw new UnprocessableEntityException('Proposal has expired');
    }
    if (
      reloaded.status === AgentProposalStatus.APPROVED ||
      reloaded.status === AgentProposalStatus.EXECUTED
    ) {
      return this.reads.toResponseWithDecider(tenantId, reloaded);
    }
    throw new ConflictException(
      `Proposal state conflict: current status is ${reloaded.status}`,
    );
  }

  /** Records an execution failure as FAILED. Audit persistence failures leave the proposal recoverable. */
  private async markExecutionFailed(
    proposal: AgentProposal,
    tenantId: string,
    approverId: string,
    error: unknown,
  ): Promise<void> {
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
            reason: error instanceof Error ? error.message : 'Execution failed',
          },
        });
        if (failed.count === 0) return;
        await this.agentActionLog.recordInTransaction(
          {
            traceId: proposal.trace_id,
            actorType: 'USER',
            agentId:
              proposal.created_by_agent ??
              getOriginatingAgentId(proposal.payload_json),
            onBehalfOfUserId: approverId,
            actionType: proposal.action_type,
            tier: 'PROPOSE',
            status: 'FAILED',
            inputSummary: { proposalId: proposal.id },
            resultSummary: {
              approvedBy: approverId,
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
}
