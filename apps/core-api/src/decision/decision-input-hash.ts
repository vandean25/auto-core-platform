import { createHash } from 'node:crypto';

export function hashDecisionInput(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableSerialize(value)))
    .digest('hex');
}

function stableSerialize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stableSerialize(entry));
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = stableSerialize(record[key]);
  }
  return result;
}
