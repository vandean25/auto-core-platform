import { randomUUID } from 'node:crypto';

const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_ALLOWED_CHARS = /^[A-Za-z0-9._:-]+$/;

/** Pick the first non-empty trimmed entry from a header value (string or repeated). */
export function firstNonEmptyHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).find((entry) => entry.length > 0);
  }
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Return the inbound x-request-id only when it fits the length cap and charset; drop it otherwise. */
export function sanitizeInboundRequestId(
  value: string | string[] | undefined,
): string | undefined {
  const candidate = firstNonEmptyHeaderValue(value);
  if (!candidate) return undefined;
  if (candidate.length > REQUEST_ID_MAX_LENGTH) return undefined;
  if (!REQUEST_ID_ALLOWED_CHARS.test(candidate)) return undefined;
  return candidate;
}

/** Resolve the correlation id for a request: reuse a valid inbound header or fall back to a fresh UUID. */
export function resolveRequestId(value: string | string[] | undefined): string {
  return sanitizeInboundRequestId(value) ?? randomUUID();
}
