import { createHash } from 'node:crypto';

export function hashInvoiceSnapshot(snapshot: unknown): string {
  return createHash('sha256')
    .update(canonicalizeJson(snapshot), 'utf8')
    .digest('hex');
}

function canonicalizeJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Invoice snapshot contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError('Invoice snapshot contains a non-JSON value.');
}
