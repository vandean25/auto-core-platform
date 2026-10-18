import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus } from '@prisma/client';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { loadTenantUserContacts } from '../common/services/tenant-user-contact.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { AgentProposalPolicyEvaluator } from './agent-proposal-policy-evaluator.service.js';
import { AgentProposalReadService } from './agent-proposal-read.service.js';
import { claimAndExecuteProposal } from './agent-proposal-decision-claim.js';
import { loadSupervisorDecisionContext } from './agent-proposal-decision-context.js';
import { resolveUnclaimedRejection } from './agent-proposal-decision-lifecycle.js';
import {
  assertRejectable,
  recordProposalRejection,
  resolveExecutorOrFail,
} from './agent-proposal-decision-mutations.js';
import { assertPolicyAllowsApproval } from './agent-proposal-decision-policy.js';
import { assertSiteMatchesSimulation } from './agent-proposal-decision-site.js';
import type {
  AgentProposalResponseDto,
  RejectAgentProposalDto,
} from './dto/agent-proposal.dto.js';

/** Human decisions on pending proposals: reject, and approve (which executes the stored payload). */
@Injectable()
export class AgentProposalDecisionService {
  readonly prisma: PrismaService;
  readonly tenantContext: TenantContextService;
  readonly agentActionLog: AgentActionLogService;
  readonly siteContext: SiteContextService;
  readonly pendingActionExecutors: PendingActionExecutorService;
  readonly policyEvaluator: AgentProposalPolicyEvaluator;
  readonly reads: AgentProposalReadService;

  constructor(
    prisma: PrismaService,
    tenantContext: TenantContextService,
    agentActionLog: AgentActionLogService,
    siteContext: SiteContextService,
    pendingActionExecutors: PendingActionExecutorService,
    policyEvaluator: AgentProposalPolicyEvaluator,
    reads: AgentProposalReadService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.agentActionLog = agentActionLog;
    this.siteContext = siteContext;
    this.pendingActionExecutors = pendingActionExecutors;
    this.policyEvaluator = policyEvaluator;
    this.reads = reads;
  }

  async rejectProposal(
    id: string,
    dto?: RejectAgentProposalDto,
  ): Promise<AgentProposalResponseDto> {
    const { tenantId, currentUser, proposal } =
      await loadSupervisorDecisionContext(this.prisma, this.tenantContext, id);

    if (proposal.status === AgentProposalStatus.REJECTED) {
      return this.reads.toResponseWithDecider(tenantId, proposal);
    }
    assertRejectable(proposal);

    const now = new Date();
    const rejectedProposal = await recordProposalRejection({
      prisma: this.prisma,
      agentActionLog: this.agentActionLog,
      proposal,
      tenantId,
      deciderId: currentUser.id,
      dto,
      now,
    });
    if (rejectedProposal) {
      return this.reads.toResponseWithDecider(tenantId, rejectedProposal);
    }
    return resolveUnclaimedRejection(
      this.prisma,
      this.reads,
      proposal,
      tenantId,
      now,
    );
  }

  async approveProposal(id: string): Promise<AgentProposalResponseDto> {
    const { tenantId, currentUser, proposal } =
      await loadSupervisorDecisionContext(this.prisma, this.tenantContext, id);

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

    const executor = await resolveExecutorOrFail(
      this.pendingActionExecutors,
      this.prisma,
      this.agentActionLog,
      proposal,
      tenantId,
      currentUser.id,
    );
    await assertPolicyAllowsApproval(this.policyEvaluator, proposal, executor);
    await assertSiteMatchesSimulation(this.siteContext, proposal);

    const deciderContacts = await loadTenantUserContacts(
      this.prisma,
      tenantId,
      [currentUser.id],
    );
    return claimAndExecuteProposal({
      prisma: this.prisma,
      agentActionLog: this.agentActionLog,
      reads: this.reads,
      proposal,
      tenantId,
      approverId: currentUser.id,
      executor,
      deciderContacts,
    });
  }
}
