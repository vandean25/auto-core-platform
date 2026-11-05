import { createHash } from 'node:crypto';

/** Deterministic hash of normalized list filters for cursor binding (ADR-0035). */
export function hashListFilterContext(
  normalized: Record<string, unknown>,
): string {
  const stable = stableStringify(normalized);
  return createHash('sha256')
    .update(stable, 'utf8')
    .digest('base64url')
    .slice(0, 22);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
