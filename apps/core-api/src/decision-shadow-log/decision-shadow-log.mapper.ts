import type { Prisma } from '@prisma/client';
import type { DecisionShadowLogRecord } from './decision-shadow-log.types.js';
import type {
  DecisionShadowActualOutcomeDto,
  DecisionShadowLogResponseDto,
  DecisionShadowSuggestionDto,
} from './dto/index.js';

export function mapDecisionShadowLog(
  record: DecisionShadowLogRecord,
): DecisionShadowLogResponseDto {
  return {
    id: record.id,
    traceId: record.trace_id,
    useCase: record.use_case,
    suggestion: mapSuggestion(record.suggestion_json),
    actualOutcome: mapActualOutcome(record.actual_outcome_json),
    latencyMs: record.latency_ms,
    error: record.error,
    provider: record.provider,
    model: record.model,
    match: record.match,
    createdAt: record.created_at,
  };
}

function mapSuggestion(
  value: Prisma.JsonValue | null,
): DecisionShadowSuggestionDto | null {
  if (!isJsonObject(value) || typeof value.choice !== 'string') {
    return null;
  }
  return {
    choice: value.choice,
    confidence: typeof value.confidence === 'number' ? value.confidence : null,
    rationale: typeof value.rationale === 'string' ? value.rationale : null,
  };
}

function mapActualOutcome(
  value: Prisma.JsonValue | null,
): DecisionShadowActualOutcomeDto | null {
  if (!isJsonObject(value) || typeof value.choice !== 'string') {
    return null;
  }
  return {
    choice: value.choice,
    source: typeof value.source === 'string' ? value.source : null,
  };
}

function isJsonObject(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
