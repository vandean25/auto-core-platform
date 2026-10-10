import { MCP_TOOL_RESULT_MAX_BYTES } from './mcp.constants.js';

const TRUNCATED_MARKER = '__truncated__';
const MCP_TOOL_RESULT_PREVIEW_CHARS = 1024;

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
