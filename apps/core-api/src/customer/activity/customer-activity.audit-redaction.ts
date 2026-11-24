import {
  REDACTED_VALUE,
  redactAuditSecrets,
} from '../../audit/audit-redaction.util.js';
import type { AuditJsonValue } from '../../audit/audit.types.js';

function maskNamedFields(
  value: unknown,
  redactedFieldNames: ReadonlySet<string>,
  prefix = '',
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      maskNamedFields(entry, redactedFieldNames, prefix),
    );
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (redactedFieldNames.has(key) || redactedFieldNames.has(path)) {
      result[key] = REDACTED_VALUE;
    } else {
      result[key] = maskNamedFields(nested, redactedFieldNames, path);
    }
  }
  return result;
}

export function buildRedactedAuditSummary(record: {
  action: string;
  actor_email: string | null;
  actor_role: string | null;
  changed_fields: unknown;
  redacted_fields: unknown;
  diff: unknown;
}): Record<string, unknown> {
  const rawRedacted = Array.isArray(record.redacted_fields)
    ? record.redacted_fields.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  const redactedSet = new Set(rawRedacted);
  const secretRedacted =
    record.diff === null || record.diff === undefined
      ? { value: null, redactedPaths: [] as string[] }
      : redactAuditSecrets(record.diff as AuditJsonValue);
  const maskedDiff = maskNamedFields(secretRedacted.value, redactedSet);

  return {
    action: record.action,
    actor_email: record.actor_email,
    actor_role: record.actor_role,
    changed_fields: Array.isArray(record.changed_fields)
      ? record.changed_fields
      : [],
    redacted_fields: [
      ...new Set([...rawRedacted, ...secretRedacted.redactedPaths]),
    ].sort(),
    diff: maskedDiff,
  };
}
