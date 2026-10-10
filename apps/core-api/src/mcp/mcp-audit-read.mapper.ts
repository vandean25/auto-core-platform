import type { AgentActionLog, AuditLog } from '@prisma/client';
import { computeAuditDiff } from '../audit/audit-diff.util.js';
import {
  maskAuditPiiForMcp,
  redactAuditSecrets,
} from '../audit/audit-redaction.util.js';
import type { AuditJsonValue } from '../audit/audit.types.js';
import { isTraceIdUuid } from '../common/services/trace-id.util.js';
import {
  capMcpValue,
  encodeMcpKeysetCursor,
  fitMcpRowsToCap,
  type McpKeysetCursor,
} from './mcp-output.util.js';

/** Changed fields returned per history entry. Larger changes report changes_total. */
export const MCP_HISTORY_MAX_CHANGES = 20;
/** Serialized bytes kept for one from or to value in a history entry. */
export const MCP_HISTORY_MAX_VALUE_BYTES = 384;
/** Serialized bytes kept for one input or result summary in an agent action detail row. */
export const MCP_ACTION_PREVIEW_MAX_BYTES = 512;

export type McpAuditEventRow = {
  id: string;
  at: string;
  entity_type: string;
  entity_id: string;
  action: AuditLog['action'];
  actor: string | null;
  trace_id?: string;
};

export type McpAuditChange = {
  field: string;
  from: unknown;
  to: unknown;
  masked?: true;
};

export type McpAuditHistoryEntry = {
  id: string;
  at: string;
  actor: string | null;
  action: AuditLog['action'];
  trace_id?: string;
  changes: McpAuditChange[];
  changes_total: number;
  changes_truncated?: true;
};

export type McpAgentActionRow = {
  id: string;
  trace_id: string;
  at: string;
  agent: string | null;
  tool: string | null;
  action_type: string;
  tier: string;
  status: string;
  entity_type: string | null;
  entity_id: string | null;
};

export type McpAgentActionDetailRow = McpAgentActionRow & {
  on_behalf_of_user_id: string | null;
  input: unknown;
  result: unknown;
};

export type McpPageMeta = { page_size: number; next_cursor: string | null };

export type McpPage<TRow, TExtra extends object = object> = TExtra & {
  data: TRow[];
  meta: McpPageMeta;
  truncated: boolean;
};

type FieldDiff = { before?: AuditJsonValue; after?: AuditJsonValue };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function traceIdField(requestId: string | null): { trace_id?: string } {
  return requestId !== null && isTraceIdUuid(requestId)
    ? { trace_id: requestId }
    : {};
}

export function keysetCursorOf(timestamp: Date, id: string): McpKeysetCursor {
  return { at: timestamp.toISOString(), id };
}

export function toMcpAuditEventRow(record: AuditLog): McpAuditEventRow {
  return {
    id: record.id,
    at: record.occurred_at.toISOString(),
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    action: record.action,
    actor: record.actor_user_id,
    ...traceIdField(record.request_id),
  };
}

/** The stored { field: { before, after } } map, or null when the row does not hold one. */
function readStoredFieldDiffs(diff: unknown): Record<string, FieldDiff> | null {
  if (!isPlainObject(diff)) {
    return null;
  }
  const entries = Object.entries(diff);
  const isFieldDiffMap =
    entries.length > 0 &&
    entries.every(
      ([, entry]) =>
        isPlainObject(entry) && ('before' in entry || 'after' in entry),
    );
  if (!isFieldDiffMap) {
    return null;
  }
  return Object.fromEntries(
    entries.map(([field, entry]) => {
      const fieldDiff = entry as Record<string, AuditJsonValue | undefined>;
      return [field, { before: fieldDiff.before, after: fieldDiff.after }];
    }),
  );
}

/** Applies the secret-key rules to one field's value, as the audit writer does for whole rows. */
function redactFieldValue(
  field: string,
  value: AuditJsonValue | undefined,
): AuditJsonValue {
  if (value === undefined) {
    return null;
  }
  const redacted = redactAuditSecrets({ [field]: value }).value;
  return isPlainObject(redacted) ? (redacted[field] ?? null) : null;
}

/**
 * Readable changes for one audit row: the stored field diff when present, else a
 * diff of before and after. Secret keys are redacted, then email, phone, and
 * address values are masked, then each value is capped.
 */
export function buildMcpAuditChanges(
  record: Pick<AuditLog, 'before' | 'after' | 'diff'>,
): { changes: McpAuditChange[]; changes_total: number } {
  const fieldDiffs: Record<string, FieldDiff> =
    readStoredFieldDiffs(record.diff) ??
    computeAuditDiff(
      redactAuditSecrets((record.before ?? null) as AuditJsonValue).value,
      redactAuditSecrets((record.after ?? null) as AuditJsonValue).value,
    ).diff;
  const fields = Object.keys(fieldDiffs).sort();

  const changes = fields
    .slice(0, MCP_HISTORY_MAX_CHANGES)
    .map((field): McpAuditChange => {
      const from = maskAuditPiiForMcp(
        redactFieldValue(field, fieldDiffs[field].before),
        field,
      );
      const to = maskAuditPiiForMcp(
        redactFieldValue(field, fieldDiffs[field].after),
        field,
      );
      const masked = from.maskedPaths.length > 0 || to.maskedPaths.length > 0;
      return {
        field,
        from: capMcpValue(from.value, MCP_HISTORY_MAX_VALUE_BYTES),
        to: capMcpValue(to.value, MCP_HISTORY_MAX_VALUE_BYTES),
        ...(masked ? { masked: true as const } : {}),
      };
    });

  return { changes, changes_total: fields.length };
}

export function toMcpAuditHistoryEntry(record: AuditLog): McpAuditHistoryEntry {
  const { changes, changes_total } = buildMcpAuditChanges(record);
  return {
    id: record.id,
    at: record.occurred_at.toISOString(),
    actor: record.actor_user_id,
    action: record.action,
    ...traceIdField(record.request_id),
    changes,
    changes_total,
    ...(changes_total > changes.length
      ? { changes_truncated: true as const }
      : {}),
  };
}

function readToolName(input: unknown): string | null {
  return isPlainObject(input) && typeof input.tool === 'string'
    ? input.tool
    : null;
}

function previewSummary(summary: unknown): unknown {
  if (summary === null || summary === undefined) {
    return null;
  }
  const { value } = maskAuditPiiForMcp(
    redactAuditSecrets(summary as AuditJsonValue).value,
  );
  return capMcpValue(value, MCP_ACTION_PREVIEW_MAX_BYTES);
}

export function toMcpAgentActionRow(record: AgentActionLog): McpAgentActionRow {
  return {
    id: record.id,
    trace_id: record.trace_id,
    at: record.created_at.toISOString(),
    agent: record.agent_id,
    tool: readToolName(record.input_summary_json),
    action_type: record.action_type,
    tier: record.tier,
    status: record.status,
    entity_type: record.entity_type,
    entity_id: record.entity_id,
  };
}

export function toMcpAgentActionDetailRow(
  record: AgentActionLog,
): McpAgentActionDetailRow {
  return {
    ...toMcpAgentActionRow(record),
    on_behalf_of_user_id: record.on_behalf_of_user_id,
    input: previewSummary(record.input_summary_json),
    result: previewSummary(record.result_summary_json),
  };
}

/**
 * One page from rows fetched with take = pageSize + 1. Rows that would push the
 * serialized result past the 32 KB cap are dropped and reported with
 * truncated: true; next_cursor then points past the last row kept.
 */
export function buildMcpKeysetPage<
  TRecord,
  TRow,
  TExtra extends object = object,
>(options: {
  records: readonly TRecord[];
  pageSize: number;
  cursorOf: (record: TRecord) => McpKeysetCursor;
  mapRow: (record: TRecord) => TRow;
  extra?: TExtra;
}): McpPage<TRow, TExtra> {
  const { records, pageSize, cursorOf, mapRow } = options;
  const extra = options.extra ?? ({} as TExtra);
  const hasMore = records.length > pageSize;
  const items = records.slice(0, pageSize).map((record) => ({
    cursor: cursorOf(record),
    row: mapRow(record),
  }));

  const buildEnvelope = (
    kept: readonly (typeof items)[number][],
  ): McpPage<TRow, TExtra> => {
    const truncated = kept.length < items.length;
    const last = kept.at(-1);
    const nextCursor =
      last && (truncated || hasMore)
        ? encodeMcpKeysetCursor(last.cursor)
        : null;
    return {
      ...extra,
      data: kept.map((item) => item.row),
      meta: { page_size: pageSize, next_cursor: nextCursor },
      truncated,
    };
  };

  return buildEnvelope(fitMcpRowsToCap(items, buildEnvelope).rows);
}
