import type { AgentPolicyTier } from '@prisma/client';

const TIER_RANK: Record<AgentPolicyTier, number> = {
  AUTO: 0,
  PROPOSE: 1,
  HUMAN_ONLY: 2,
};

export function compareTierStrictness(
  left: AgentPolicyTier,
  right: AgentPolicyTier,
): number {
  return TIER_RANK[left] - TIER_RANK[right];
}

export function isTierAtLeastAsStrictAs(
  candidate: AgentPolicyTier,
  baseline: AgentPolicyTier,
): boolean {
  return TIER_RANK[candidate] >= TIER_RANK[baseline];
}

export function maxTier(
  left: AgentPolicyTier,
  right: AgentPolicyTier,
): AgentPolicyTier {
  return TIER_RANK[left] >= TIER_RANK[right] ? left : right;
}
