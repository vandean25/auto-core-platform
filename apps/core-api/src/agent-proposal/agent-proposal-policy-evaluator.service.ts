import { Injectable } from '@nestjs/common';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import type { PendingActionExecutor } from '../pending-action-executor/pending-action-executor.service.js';
import { extractPolicyContext } from './agent-proposal-policy-context.js';

/**
 * Hands a pending action to the policy engine. Workshop line items are priced
 * from the payload itself; every other action asks its executor for context.
 */
@Injectable()
export class AgentProposalPolicyEvaluator {
  constructor(private readonly agentPolicyService: AgentPolicyService) {}

  async evaluate(
    actionType: string,
    payload: unknown,
    executor: PendingActionExecutor,
  ) {
    const context: AgentPolicyEvaluateContext =
      actionType === 'workshop_order.add_line'
        ? extractPolicyContext(payload, actionType)
        : await executor.buildPolicyContext(payload);
    return this.agentPolicyService.evaluate(
      { action_type: actionType, context },
      { skipAdminCheck: true },
    );
  }
}
