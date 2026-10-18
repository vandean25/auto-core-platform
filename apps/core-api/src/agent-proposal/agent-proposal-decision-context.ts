import { UnprocessableEntityException } from '@nestjs/common';
import type { AgentProposal } from '@prisma/client';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { assertSupervisorAccess } from './agent-proposal.authorization.js';
import {
  expirePendingProposal,
  proposalIsExpired,
} from './agent-proposal-decision-lifecycle.js';
import { findProposalOrThrow } from './agent-proposal-decision-mutations.js';

export type SupervisorDecisionContext = {
  tenantId: string;
  currentUser: { id: string };
  proposal: AgentProposal;
};

export async function loadSupervisorDecisionContext(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  proposalId: string,
): Promise<SupervisorDecisionContext> {
  assertSupervisorAccess(tenantContext);
  const tenantId = await tenantContext.getTenantId();
  const currentUser = await requireActiveCurrentUser(
    prisma,
    tenantContext,
    tenantId,
  );
  const proposal = await findProposalOrThrow(prisma, proposalId, tenantId);
  if (proposalIsExpired(proposal)) {
    await expirePendingProposal(prisma, proposal, tenantId);
    throw new UnprocessableEntityException('Proposal has expired');
  }
  return { tenantId, currentUser, proposal };
}
