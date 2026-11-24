import { AgentPolicyTier, AgentProposalStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { toAgentProposalResponseDto } from './agent-proposal-response.mapper.js';
import type { AgentProposalResponseDto } from './dto/agent-proposal.dto.js';

export type PersistPendingAgentProposalInput = {
  action_type: string;
  payload_json: unknown;
  preview_json: unknown;
  tier: AgentPolicyTier;
  trace_id: string;
  created_by_agent?: string;
  command_id?: string;
};

/** Shared persistence helper used by both API submissions and the PDF worker. */
export async function persistPendingAgentProposal(
  prisma: PrismaService,
  tenantId: string,
  input: PersistPendingAgentProposalInput,
): Promise<AgentProposalResponseDto> {
  const created = await prisma.agentProposal.create({
    data: {
      tenant_id: tenantId,
      trace_id: input.trace_id,
      action_type: input.action_type,
      payload_json: input.payload_json as Prisma.InputJsonValue,
      preview_json: input.preview_json as Prisma.InputJsonValue,
      tier: input.tier,
      status: AgentProposalStatus.PENDING,
      created_by_agent: input.created_by_agent ?? null,
      command_id: input.command_id ?? null,
    },
  });
  return toAgentProposalResponseDto(created);
}
