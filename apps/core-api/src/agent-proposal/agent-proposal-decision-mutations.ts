import { ConflictException, NotFoundException } from '@nestjs/common';
import { AgentProposalStatus, type AgentProposal } from '@prisma/client';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import type { PendingActionExecutor } from '../pending-action-executor/pending-action-executor.types.js';
import { proposalUserAuditBase } from './agent-proposal-decision-audit.js';
import type { RejectAgentProposalDto } from './dto/agent-proposal.dto.js';

export function assertRejectable(proposal: AgentProposal): void {
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

export async function findProposalOrThrow(
  prisma: PrismaService,
  id: string,
  tenantId: string,
): Promise<AgentProposal> {
  const proposal = await prisma.agentProposal.findFirst({
    where: { id, tenant_id: tenantId },
  });
  if (!proposal) {
    throw new NotFoundException('Proposal not found');
  }
  return proposal;
}

export type RecordRejectionParams = {
  prisma: PrismaService;
  agentActionLog: AgentActionLogService;
  proposal: AgentProposal;
  tenantId: string;
  deciderId: string;
  dto?: RejectAgentProposalDto;
  now: Date;
};

/** Claims a PENDING proposal as REJECTED. Returns null when another request decided it first. */
export async function recordProposalRejection(
  params: RecordRejectionParams,
): Promise<AgentProposal | null> {
  const { prisma, agentActionLog, proposal, tenantId, deciderId, dto, now } =
    params;
  return prisma.$transaction(async (tx) => {
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

    await agentActionLog.recordInTransaction(
      {
        ...proposalUserAuditBase({
          traceId: proposal.trace_id,
          proposal,
          onBehalfOfUserId: deciderId,
        }),
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

export async function resolveExecutorOrFail(
  pendingActionExecutors: PendingActionExecutorService,
  prisma: PrismaService,
  agentActionLog: AgentActionLogService,
  proposal: AgentProposal,
  tenantId: string,
  approverId: string,
): Promise<PendingActionExecutor> {
  try {
    return pendingActionExecutors.resolve(proposal.action_type);
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      const failed = await tx.agentProposal.updateMany({
        where: {
          id: proposal.id,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: error instanceof Error ? error.message : 'Unsupported action',
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
