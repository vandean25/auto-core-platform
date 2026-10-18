import { Logger, NotFoundException } from '@nestjs/common';
import { AgentProposalStatus, type AgentProposal } from '@prisma/client';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantUserContact } from '../common/services/tenant-user-contact.util.js';
import type { PendingActionExecutor } from '../pending-action-executor/pending-action-executor.service.js';
import { siteBoundExecutionContext } from './site-bound-pending-actions.js';
import { proposalUserAuditBase } from './agent-proposal-decision-audit.js';
import { toAgentProposalResponseDto } from './agent-proposal-response.mapper.js';
import type { AgentProposalResponseDto } from './dto/agent-proposal.dto.js';
import { resolveUnclaimedApproval } from './agent-proposal-decision-lifecycle.js';
import type { AgentProposalReadService } from './agent-proposal-read.service.js';

const claimLogger = new Logger('AgentProposalDecisionClaim');

export type ClaimAndExecuteParams = {
  prisma: PrismaService;
  agentActionLog: AgentActionLogService;
  reads: AgentProposalReadService;
  proposal: AgentProposal;
  tenantId: string;
  approverId: string;
  executor: PendingActionExecutor;
  deciderContacts: Map<string, TenantUserContact>;
};

export async function claimAndExecuteProposal(
  params: ClaimAndExecuteParams,
): Promise<AgentProposalResponseDto> {
  const {
    prisma,
    agentActionLog,
    reads,
    proposal,
    tenantId,
    approverId,
    executor,
    deciderContacts,
  } = params;
  const now = new Date();
  let claimed = false;
  try {
    const outcome = await prisma.$transaction(async (tx) => {
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

      const executionContext = siteBoundExecutionContext(
        proposal.action_type,
        proposal.preview_json,
      );

      await agentActionLog.recordInTransaction(
        {
          ...proposalUserAuditBase({
            traceId: proposal.trace_id,
            proposal,
            onBehalfOfUserId: approverId,
          }),
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
            executor.execute(proposal.payload_json, executionContext),
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
    return await resolveUnclaimedApproval(
      prisma,
      reads,
      proposal,
      tenantId,
      now,
    );
  } catch (error) {
    if (claimed) {
      await markExecutionFailed({
        prisma,
        agentActionLog,
        proposal,
        tenantId,
        approverId,
        error,
      });
    }
    throw error;
  }
}

export async function markExecutionFailed(params: {
  prisma: PrismaService;
  agentActionLog: AgentActionLogService;
  proposal: AgentProposal;
  tenantId: string;
  approverId: string;
  error: unknown;
}): Promise<void> {
  const { prisma, agentActionLog, proposal, tenantId, approverId, error } =
    params;
  const reason = error instanceof Error ? error.message : 'Execution failed';
  try {
    await prisma.$transaction(async (tx) => {
      const failed = await tx.agentProposal.updateMany({
        where: {
          id: proposal.id,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason,
        },
      });
      if (failed.count === 0) return;
      await agentActionLog.recordInTransaction(
        {
          ...proposalUserAuditBase({
            traceId: proposal.trace_id,
            proposal,
            onBehalfOfUserId: approverId,
          }),
          status: 'FAILED',
          inputSummary: { proposalId: proposal.id },
          resultSummary: {
            approvedBy: approverId,
            error: reason,
          },
        },
        tx,
      );
    });
  } catch (auditError) {
    claimLogger.warn(
      `Failed to persist execution failure for proposal ${proposal.id}: ${
        auditError instanceof Error ? auditError.message : 'unknown error'
      }`,
    );
  }
}
