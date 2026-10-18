import type { AgentProposal } from '@prisma/client';
import { getOriginatingAgentId } from './agent-proposal-payload.js';

export type ProposalAuditActor = {
  traceId: string;
  proposal: AgentProposal;
  onBehalfOfUserId: string;
};

export function proposalAgentId(proposal: AgentProposal): string | undefined {
  return (
    proposal.created_by_agent ?? getOriginatingAgentId(proposal.payload_json)
  );
}

export function proposalUserAuditBase({
  traceId,
  proposal,
  onBehalfOfUserId,
}: ProposalAuditActor) {
  return {
    traceId,
    actorType: 'USER' as const,
    agentId: proposalAgentId(proposal),
    onBehalfOfUserId,
    actionType: proposal.action_type,
    tier: 'PROPOSE' as const,
  };
}
