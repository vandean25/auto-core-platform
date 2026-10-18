import { UnprocessableEntityException } from '@nestjs/common';
import { AgentPolicyTier, type AgentProposal } from '@prisma/client';
import type { PendingActionExecutor } from '../pending-action-executor/pending-action-executor.types.js';
import type { AgentProposalPolicyEvaluator } from './agent-proposal-policy-evaluator.service.js';

export async function assertPolicyAllowsApproval(
  policyEvaluator: AgentProposalPolicyEvaluator,
  proposal: AgentProposal,
  executor: PendingActionExecutor,
): Promise<void> {
  const evaluation = await policyEvaluator.evaluate(
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
