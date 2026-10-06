export const AGENT_POLICY_AUDIT_SOURCE = 'agent_policy';
export const AGENT_POLICY_ENTITY_TYPE = 'AgentPolicyRule';

export const AGENT_POLICY_ERROR_CODES = {
  LOOSER_THAN_PLATFORM: 'AGENT_POLICY_LOOSER_THAN_PLATFORM',
  UNKNOWN_ACTION_TYPE: 'AGENT_POLICY_UNKNOWN_ACTION_TYPE',
  VERSION_CONFLICT: 'AGENT_POLICY_VERSION_CONFLICT',
} as const;

/**
 * Platform policy action types introduced by the MCP write tools (AUT-400).
 *
 * Each value maps to a platform-default rule seeded in a migration so the
 * evaluator never falls back to `unknown_action_fail_closed` (HUMAN_ONLY)
 * for these reversible, back-office actions.
 */
export const MCP_WRITE_POLICY_ACTION_TYPES = {
  draft_workshop_order: 'workshop_order.create',
  reserve_part: 'inventory.part_reserve',
  release_reservation: 'inventory.part_release',
  propose_line_item: 'workshop_order.propose_line',
} as const;

export type McpWritePolicyActionType =
  (typeof MCP_WRITE_POLICY_ACTION_TYPES)[keyof typeof MCP_WRITE_POLICY_ACTION_TYPES];
