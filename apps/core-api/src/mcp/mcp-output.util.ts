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
