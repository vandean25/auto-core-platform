import { createHash } from 'node:crypto';

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    const elements = value.map(canonicalize).sort();
    return `[${elements.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashCreditNoteFinalizeRequest(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex');
}
