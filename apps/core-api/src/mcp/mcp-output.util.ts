import { MCP_TOOL_RESULT_MAX_BYTES } from './mcp.constants.js';

const TRUNCATED_MARKER = '__truncated__';
const MCP_TOOL_RESULT_PREVIEW_CHARS = 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function capMcpToolPayload<T>(value: T): T | Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized.length <= MCP_TOOL_RESULT_MAX_BYTES) {
    return value;
  }
  return {
    [TRUNCATED_MARKER]: true,
    originalBytes: serialized.length,
    preview: serialized.slice(0, MCP_TOOL_RESULT_PREVIEW_CHARS),
  };
}

export function clampMcpPageSize(pageSize?: number): number {
  if (!pageSize || !Number.isFinite(pageSize) || pageSize < 1) {
    return 10;
  }
  return Math.min(Math.floor(pageSize), 25);
}

export function clampMcpPage(page?: number): number {
  if (!page || !Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.floor(page);
}

/** Opaque cursor for offset paging over a static list. */
export function encodeMcpCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

/** Offset encoded by a cursor from encodeMcpCursor, or null when it is not one. */
export function decodeMcpCursor(cursor: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^\d+$/.test(decoded)) {
    return null;
  }
  const offset = Number(decoded);
  return Number.isSafeInteger(offset) ? offset : null;
}

/** Position of the last row on a page, in a keyset over (timestamp, id). */
export type McpKeysetCursor = { at: string; id: string };

/** Opaque cursor for keyset paging over timestamped rows. */
export function encodeMcpKeysetCursor(cursor: McpKeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Keyset position encoded by encodeMcpKeysetCursor, or null when it is not one. */
export function decodeMcpKeysetCursor(cursor: string): McpKeysetCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const { at, id } = parsed as Record<string, unknown>;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
    return null;
  }
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    return null;
  }
  return { at, id };
}

/** Inclusive start of a from bound. A bare date starts at its first UTC instant. */
export function normalizeMcpRangeStart(value: string): string {
  return ISO_DATE_ONLY_PATTERN.test(value) ? `${value}T00:00:00.000Z` : value;
}

/** Inclusive end of a to bound. A bare date runs through its last UTC millisecond. */
export function normalizeMcpRangeEnd(value: string): string {
  return ISO_DATE_ONLY_PATTERN.test(value) ? `${value}T23:59:59.999Z` : value;
}

/** Caps one nested value to maxBytes of serialized JSON and leaves an explicit marker. */
export function capMcpValue(value: unknown, maxBytes: number): unknown {
  const serialized = JSON.stringify(value) ?? 'null';
  const originalBytes = Buffer.byteLength(serialized, 'utf8');
  if (originalBytes <= maxBytes) {
    return value;
  }
  return {
    [TRUNCATED_MARKER]: true,
    originalBytes,
    preview: serialized.slice(0, Math.floor(maxBytes / 2)),
  };
}

/**
 * Keeps the leading rows whose serialized envelope stays within maxBytes. When
 * `truncated` is true the caller returns a cursor from the last kept row, so the
 * dropped rows are reached on the next page.
 */
export function fitMcpRowsToCap<T>(
  rows: readonly T[],
  buildEnvelope: (keptRows: readonly T[]) => unknown,
  maxBytes: number = MCP_TOOL_RESULT_MAX_BYTES,
): { rows: T[]; truncated: boolean } {
  let keep = rows.length;
  while (
    keep > 0 &&
    Buffer.byteLength(
      JSON.stringify(buildEnvelope(rows.slice(0, keep))) ?? '',
      'utf8',
    ) > maxBytes
  ) {
    keep -= 1;
  }
  return { rows: rows.slice(0, keep), truncated: keep < rows.length };
}
