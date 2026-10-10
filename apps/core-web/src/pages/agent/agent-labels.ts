/**
 * Labels for agent and decider names on the supervision screen. The approval
 * card and the Activity table both read these, so one proposal shows one agent.
 */

/**
 * The agent that created the proposal. Falls back to the agent id in the
 * payload (same order the backend uses for the Activity row), then to the
 * generic word only when no agent is recorded anywhere.
 */
export function resolveProposalAgentName(
  createdByAgent: string | null | undefined,
  payload: Record<string, unknown>,
): string {
  const payloadAgentId = payload.agent_id ?? payload.agentId
  const fromPayload =
    typeof payloadAgentId === 'string' && payloadAgentId.length > 0
      ? payloadAgentId
      : undefined
  return createdByAgent ?? fromPayload ?? 'agent'
}

/**
 * The agent on an Activity row: the logged agent id, or the generic word. The
 * API types this field loosely, so anything that is not a string is ignored.
 */
export function resolveActivityAgentName(agentId: unknown): string {
  return typeof agentId === 'string' ? agentId : 'agent'
}

/** A user id from the API, or null. The API types this field loosely, so only non-empty strings count. */
export function resolveUserId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The name under "Decided by": the person's name, then their email, then a
 * fallback label. A raw user id is never returned here; it lives under details.
 */
export function resolveDecidedByLabel(
  person: { name: string | null | undefined; email: string | null | undefined },
  unknownUserLabel: string,
): string {
  return person.name || person.email || unknownUserLabel
}
