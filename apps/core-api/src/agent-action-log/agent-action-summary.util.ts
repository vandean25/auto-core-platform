import { redactAuditSecrets } from '../audit/audit-redaction.util.js';
import type { AuditJsonValue } from '../audit/audit.types.js';

export const AGENT_ACTION_SUMMARY_TRUNCATED_MARKER = '__truncated__';
export const AGENT_ACTION_SUMMARY_MAX_BYTES = 16_384;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function redactAgentActionSummary(
  value: unknown,
): AuditJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  const { value: redacted } = redactAuditSecrets(value as AuditJsonValue);
  return capAgentActionSummary(redacted);
}

export function capAgentActionSummary(value: AuditJsonValue): AuditJsonValue {
  const serialized = JSON.stringify(value);
  if (serialized.length <= AGENT_ACTION_SUMMARY_MAX_BYTES) {
    return value;
  }

  if (isPlainObject(value)) {
    return {
      ...value,
      [AGENT_ACTION_SUMMARY_TRUNCATED_MARKER]: true,
      originalBytes: serialized.length,
    };
  }

  return {
    [AGENT_ACTION_SUMMARY_TRUNCATED_MARKER]: true,
    originalBytes: serialized.length,
    preview: serialized.slice(0, 512),
  };
}
