import { UnprocessableEntityException } from '@nestjs/common';
import { AGENT_POLICY_ERROR_CODES } from './agent-policy.constants.js';
import type { AgentPolicyConditions } from './agent-policy.types.js';

export function mergeAgentPolicyConditions(
  platform: AgentPolicyConditions,
  override?: AgentPolicyConditions,
): AgentPolicyConditions {
  if (override === undefined) {
    return { ...platform };
  }

  const definedOverride = Object.fromEntries(
    Object.entries(override).filter(([, value]) => value !== undefined),
  ) as AgentPolicyConditions;

  return { ...platform, ...definedOverride };
}

export function assertConditionsAtLeastAsStrictAs(
  candidate: AgentPolicyConditions,
  platform: AgentPolicyConditions,
): void {
  if (typeof platform.amount_max === 'number') {
    const candidateCap = candidate.amount_max;
    if (
      candidateCap === null ||
      candidateCap === undefined ||
      candidateCap > platform.amount_max
    ) {
      throw new UnprocessableEntityException({
        code: AGENT_POLICY_ERROR_CODES.LOOSER_THAN_PLATFORM,
        message:
          'Tenant policy amount_max must be at least as strict as the platform default.',
      });
    }
  }

  if (platform.customer_facing === true && candidate.customer_facing !== true) {
    throw new UnprocessableEntityException({
      code: AGENT_POLICY_ERROR_CODES.LOOSER_THAN_PLATFORM,
      message:
        'Tenant policy must keep customer_facing when the platform default requires it.',
    });
  }
}
