import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  persistPendingAgentProposal,
  type PersistPendingAgentProposalInput,
} from '../agent-proposal/agent-proposal-persistence.util.js';
import type { AgentProposalResponseDto } from '../agent-proposal/dto/agent-proposal.dto.js';

/**
 * Worker-scoped subset of AgentProposalService for DecisionDocumentSortApplier.
 * Persists PROPOSE-tier pending actions without pulling in PendingActionExecutorModule.
 */
@Injectable()
export class WorkerAgentProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async persistPendingAction(
    input: PersistPendingAgentProposalInput,
  ): Promise<AgentProposalResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    return persistPendingAgentProposal(this.prisma, tenantId, input);
  }
}
