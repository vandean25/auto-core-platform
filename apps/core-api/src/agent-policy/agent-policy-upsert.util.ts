import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AgentPolicyTier } from '@prisma/client';
import { AGENT_POLICY_ERROR_CODES } from './agent-policy.constants.js';
import {
  assertConditionsAtLeastAsStrictAs,
  mergeAgentPolicyConditions,
} from './agent-policy-conditions.util.js';
import { isTierAtLeastAsStrictAs } from './agent-policy-tier.util.js';
import type { AgentPolicyConditions } from './agent-policy.types.js';

export function normalizeActionType(actionType: string): string {
  const normalized = actionType.trim();
  if (!normalized) {
    throw new BadRequestException('action_type is required');
  }
  return normalized;
}

export function assertTierNotLooserThanPlatform(
  tier: AgentPolicyTier,
  platformTier: AgentPolicyTier,
): void {
  if (!isTierAtLeastAsStrictAs(tier, platformTier)) {
    throw new UnprocessableEntityException({
      code: AGENT_POLICY_ERROR_CODES.LOOSER_THAN_PLATFORM,
      message:
        'Tenant policy tier must be at least as strict as the platform default.',
    });
  }
}

/**
 * Platform conditions with the tenant's overrides applied. Throws when the
 * result loosens a platform cap.
 */
export function resolveTenantConditions(
  platform: AgentPolicyConditions,
  override?: AgentPolicyConditions,
): AgentPolicyConditions {
  const conditions = mergeAgentPolicyConditions(platform, override);
  assertConditionsAtLeastAsStrictAs(conditions, platform);
  return conditions;
}

/**
 * Maps a failed version write to the API error it means. A unique violation
 * on the version is a concurrent update; the database guard for a looser tier
 * maps to a 422. Any other error is returned unchanged.
 */
export function toUpsertPersistenceError(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return new ConflictException({
      code: AGENT_POLICY_ERROR_CODES.VERSION_CONFLICT,
      message:
        'A concurrent update created the same rule version. Retry the request.',
    });
  }
  if (
    error instanceof Error &&
    error.message.includes('agent_policy_tenant_tier_looser_than_platform')
  ) {
    return new UnprocessableEntityException({
      code: AGENT_POLICY_ERROR_CODES.LOOSER_THAN_PLATFORM,
      message:
        'Tenant policy must be at least as strict as the platform default.',
    });
  }
  return error;
}
