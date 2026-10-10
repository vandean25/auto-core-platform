import type { Prisma } from '@prisma/client';
import {
  agentActionRecordInputSchema,
  type AgentActionRecordInput,
  type AgentActionStatus,
} from './agent-action-log.types.js';
import { redactAgentActionSummary } from './agent-action-summary.util.js';

export type ParsedAgentActionRecord = ReturnType<
  typeof agentActionRecordInputSchema.parse
>;

/** What a work call produced. A thrown value counts as a failure only when it is truthy. */
export type WorkOutcome<T> = {
  failed: boolean;
  error: unknown;
  result: T | undefined;
};

/** The row fields that depend on how the work ended. */
export type WorkRecordFields = {
  status: AgentActionStatus;
  resultSummary: unknown;
  entityType: string | null;
  entityId: string | null;
  reversible: boolean;
};

/** Stored message for failed work: an Error keeps its message, other thrown values get a generic one. */
export function describeWorkError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Agent action work failed';
}

/** A summary given as a function is called with the work result; a value is used as it is. */
export function resolveResultSummary<T>(
  parsed: ParsedAgentActionRecord,
  workResult: T | undefined,
): unknown {
  return typeof parsed.resultSummary === 'function'
    ? (parsed.resultSummary as (result: T | undefined) => unknown)(workResult)
    : parsed.resultSummary;
}

/**
 * Row fields for a call. Failed work is recorded as FAILED with its error as the summary, and the
 * result metadata is ignored. The summary function runs even when the work failed.
 */
export function resolveWorkRecordFields<T>(
  parsed: ParsedAgentActionRecord,
  work: WorkOutcome<T>,
  metadataFromResult?: (
    result: T | undefined,
  ) => Partial<AgentActionRecordInput>,
): WorkRecordFields {
  const resolvedSummary = resolveResultSummary(parsed, work.result);
  const failureMessage = work.failed ? describeWorkError(work.error) : undefined;
  const resultMetadata: Partial<AgentActionRecordInput> = work.failed
    ? {}
    : (metadataFromResult?.(work.result) ?? {});
  return {
    status: work.failed ? 'FAILED' : parsed.status,
    resultSummary: failureMessage ? { error: failureMessage } : resolvedSummary,
    entityType: resultMetadata.entityType ?? parsed.entityType ?? null,
    entityId: resultMetadata.entityId ?? parsed.entityId ?? null,
    reversible: resultMetadata.reversible ?? parsed.reversible ?? false,
  };
}

/** The agent_action_logs row for a call: the scope and input come from the parsed record. */
export function buildAgentActionLogCreateData(
  parsed: ParsedAgentActionRecord,
  scope: { tenantId: string; traceId: string },
  fields: WorkRecordFields,
) {
  return {
    tenant_id: scope.tenantId,
    trace_id: scope.traceId,
    parent_trace_id: parsed.parentTraceId ?? null,
    actor_type: parsed.actorType,
    agent_id: parsed.agentId ?? null,
    on_behalf_of_user_id: parsed.onBehalfOfUserId ?? null,
    api_key_id: parsed.apiKeyId ?? null,
    action_type: parsed.actionType,
    tier: parsed.tier,
    status: fields.status,
    input_summary_json: redactAgentActionSummary(
      parsed.inputSummary,
    ) as Prisma.InputJsonValue,
    result_summary_json: redactAgentActionSummary(
      fields.resultSummary,
    ) as Prisma.InputJsonValue,
    entity_type: fields.entityType,
    entity_id: fields.entityId,
    reversible: fields.reversible,
    reverted_by_log_id: parsed.revertedByLogId ?? null,
  };
}
