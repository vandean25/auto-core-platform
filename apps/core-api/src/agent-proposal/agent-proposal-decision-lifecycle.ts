import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentProposalStatus, type AgentProposal } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AgentProposalReadService } from './agent-proposal-read.service.js';

export function proposalIsExpired(
  proposal: AgentProposal,
  now: Date = new Date(),
): boolean {
  return (
    proposal.status === AgentProposalStatus.EXPIRED ||
    (proposal.status === AgentProposalStatus.PENDING &&
      proposal.expires_at < now)
  );
}

export function proposalIsExpiredAfterClaim(
  proposal: AgentProposal,
  now: Date,
): boolean {
  return (
    proposal.status === AgentProposalStatus.PENDING &&
    proposal.expires_at <= now
  );
}

export function proposalIsExpiredOnReload(
  proposal: AgentProposal,
  now: Date,
): boolean {
  return (
    proposal.status === AgentProposalStatus.EXPIRED ||
    (proposal.status === AgentProposalStatus.PENDING &&
      proposal.expires_at <= now)
  );
}

export async function expirePendingProposal(
  prisma: PrismaService,
  proposal: AgentProposal,
  tenantId: string,
): Promise<void> {
  if (proposal.status !== AgentProposalStatus.PENDING) return;
  await prisma.agentProposal.updateMany({
    where: {
      id: proposal.id,
      tenant_id: tenantId,
      status: AgentProposalStatus.PENDING,
    },
    data: { status: AgentProposalStatus.EXPIRED },
  });
}

export async function resolveUnclaimedRejection(
  prisma: PrismaService,
  reads: AgentProposalReadService,
  proposal: AgentProposal,
  tenantId: string,
  now: Date,
) {
  const reloaded = await prisma.agentProposal.findFirst({
    where: { id: proposal.id, tenant_id: tenantId },
  });
  if (!reloaded) throw new NotFoundException('Proposal not found');
  if (proposalIsExpiredOnReload(reloaded, now)) {
    await expirePendingProposal(prisma, reloaded, tenantId);
    throw new UnprocessableEntityException('Proposal has expired');
  }
  if (reloaded.status === AgentProposalStatus.REJECTED) {
    return reads.toResponseWithDecider(tenantId, reloaded);
  }
  throw new ConflictException(
    `Proposal state conflict: current status is ${reloaded.status}`,
  );
}

export async function resolveUnclaimedApproval(
  prisma: PrismaService,
  reads: AgentProposalReadService,
  proposal: AgentProposal,
  tenantId: string,
  now: Date,
) {
  const reloaded = await prisma.agentProposal.findFirst({
    where: { id: proposal.id, tenant_id: tenantId },
  });
  if (!reloaded) throw new NotFoundException('Proposal not found');
  if (proposalIsExpiredAfterClaim(reloaded, now)) {
    await expirePendingProposal(prisma, reloaded, tenantId);
    throw new UnprocessableEntityException('Proposal has expired');
  }
  if (
    reloaded.status === AgentProposalStatus.APPROVED ||
    reloaded.status === AgentProposalStatus.EXECUTED
  ) {
    return reads.toResponseWithDecider(tenantId, reloaded);
  }
  throw new ConflictException(
    `Proposal state conflict: current status is ${reloaded.status}`,
  );
}
