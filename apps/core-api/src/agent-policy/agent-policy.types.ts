import type { AgentPolicyTier } from '@prisma/client';

export type AgentPolicyConditions = {
  amount_max?: number | null;
  customer_facing?: boolean;
  reversible?: boolean;
  affects_legal_document?: boolean;
};

export type AgentPolicyEvaluateContext = {
  amount_eur?: number;
  customer_facing?: boolean;
  reversible?: boolean;
  affects_legal_document?: boolean;
};

export type ResolvedAgentPolicyRule = {
  id: string;
  version: number;
  action_type: string;
  tier: AgentPolicyTier;
  conditions: AgentPolicyConditions;
  enabled: boolean;
  source: 'platform' | 'tenant';
  created_at: Date;
  updated_at: Date;
};

export type AgentPolicyEvaluationResult = {
  tier: AgentPolicyTier;
  reasons: string[];
  rule_id: string | null;
  rule_version: number | null;
};
