import {
  REDACTED_VALUE,
  redactAuditSecrets,
} from '../audit/audit-redaction.util.js';
import type { AuditJsonValue } from '../audit/audit.types.js';

export const AGENT_ACTION_SUMMARY_TRUNCATED_MARKER = '__truncated__';
export const AGENT_ACTION_SUMMARY_MAX_BYTES = 16_384;

const AGENT_SUMMARY_SECRET_KEYS = new Set(['token', 'secret']);

const normalizeFieldName = (fieldName: string): string =>
  fieldName.toLowerCase().replace(/[^a-z0-9]/g, '');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function redactAgentSummarySecretKeys(
  value: AuditJsonValue,
): AuditJsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => redactAgentSummarySecretKeys(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const redacted: Record<string, AuditJsonValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (AGENT_SUMMARY_SECRET_KEYS.has(normalizeFieldName(key))) {
      redacted[key] = REDACTED_VALUE;
      continue;
    }
    redacted[key] = redactAgentSummarySecretKeys(nested as AuditJsonValue);
  }
  return redacted;
}

export function redactAgentActionSummary(
  value: unknown,
): AuditJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  const { value: redacted } = redactAuditSecrets(value as AuditJsonValue);
  return capAgentActionSummary(redactAgentSummarySecretKeys(redacted));
}

export function capAgentActionSummary(value: AuditJsonValue): AuditJsonValue {
  const serialized = JSON.stringify(value);
  if (serialized.length <= AGENT_ACTION_SUMMARY_MAX_BYTES) {
    return value;
  }

  return {
    [AGENT_ACTION_SUMMARY_TRUNCATED_MARKER]: true,
    originalBytes: serialized.length,
    preview: serialized.slice(0, 512),
  };
}
