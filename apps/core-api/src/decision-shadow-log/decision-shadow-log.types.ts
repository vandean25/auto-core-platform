import type { Prisma } from '@prisma/client';
import { DECISION_USE_CASES } from '../decision/decision.constants.js';

export const DECISION_SHADOW_USE_CASES = Object.values(DECISION_USE_CASES);

/**
 * Columns exposed by the read API. `input_redacted_json` and `input_hash` are
 * deliberately left out: QA needs the outcome and suggestion, not the payload.
 */
export const DECISION_SHADOW_LOG_SELECT = {
  id: true,
  trace_id: true,
  use_case: true,
  suggestion_json: true,
  actual_outcome_json: true,
  match: true,
  provider: true,
  model: true,
  latency_ms: true,
  error: true,
  created_at: true,
} as const satisfies Prisma.DecisionShadowLogSelect;

export type DecisionShadowLogRecord = Prisma.DecisionShadowLogGetPayload<{
  select: typeof DECISION_SHADOW_LOG_SELECT;
}>;
