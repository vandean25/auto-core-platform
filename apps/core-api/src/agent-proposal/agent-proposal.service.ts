import { Injectable } from '@nestjs/common';
import type { AgentPolicyTier } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertSupervisorAccess } from './agent-proposal.authorization.js';
import { AgentProposalDecisionService } from './agent-proposal-decision.service.js';
import {
  resolveLineItemFinancials,
  type LineItemFinancials,
} from './agent-proposal-financials.js';
import { AgentProposalReadService } from './agent-proposal-read.service.js';
import { AgentProposalSubmissionService } from './agent-proposal-submission.service.js';
import type { SubmitPendingActionOptions } from './agent-proposal-submission.service.js';
import type {
  BatchApplyAgentProposalsDto,
  BatchApplyAgentProposalsResponseDto,
  AgentProposalListResponseDto,
  AgentProposalResponseDto,
  CreateAgentProposalDto,
  QueryAgentProposalsDto,
  RejectAgentProposalDto,
  SubmitPendingAgentActionDto,
} from './dto/agent-proposal.dto.js';

export { resolveLineItemFinancials };
export type { LineItemFinancials };

/**
 * Public entry point for agent proposals. Each method delegates to the
 * collaborator that owns the responsibility (reads, decisions, submissions).
 */
@Injectable()
export class AgentProposalService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly reads: AgentProposalReadService,
    private readonly decisions: AgentProposalDecisionService,
    private readonly submissions: AgentProposalSubmissionService,
  ) {}

  async listProposals(
    query: QueryAgentProposalsDto,
  ): Promise<AgentProposalListResponseDto> {
    return this.reads.listProposals(query);
  }

  async getProposalById(id: string): Promise<AgentProposalResponseDto> {
    return this.reads.getProposalById(id);
  }

  async rejectProposal(
    id: string,
    dto?: RejectAgentProposalDto,
  ): Promise<AgentProposalResponseDto> {
    return this.decisions.rejectProposal(id, dto);
  }

  async approveProposal(id: string): Promise<AgentProposalResponseDto> {
    return this.decisions.approveProposal(id);
  }

  /** Applies each proposal on its own; one failure does not stop the others. */
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
    return this.submissions.createProposal(dto);
  }

  async persistPendingAction(input: {
    action_type: string;
    payload_json: unknown;
    preview_json: unknown;
    tier: AgentPolicyTier;
    trace_id: string;
    created_by_agent?: string;
    command_id?: string;
  }): Promise<AgentProposalResponseDto> {
    return this.submissions.persistPendingAction(input);
  }

  async submitPendingAction(
    dto: SubmitPendingAgentActionDto,
    options?: SubmitPendingActionOptions,
  ): Promise<AgentProposalResponseDto> {
    return options
      ? this.submissions.submitPendingAction(dto, options)
      : this.submissions.submitPendingAction(dto);
  }

  resolveLineItemFinancials(
    record: Record<string, unknown>,
  ): LineItemFinancials {
    return resolveLineItemFinancials(record);
  }
}
