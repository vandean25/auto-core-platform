import { createHash } from 'node:crypto';
const COMMAND_ID_FIELD = 'command_id';

export type ParsedMcpWriteInput = {
  commandId?: string;
  businessInput: Record<string, unknown>;
};

export function parseMcpWriteCommandInput(input: unknown): ParsedMcpWriteInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { businessInput: {} };
  }
  const record = { ...(input as Record<string, unknown>) };
  const commandId = record[COMMAND_ID_FIELD];
  delete record[COMMAND_ID_FIELD];
  return {
    commandId: typeof commandId === 'string' ? commandId : undefined,
    businessInput: record,
  };
}

/** Canonical fingerprint for tool args; `command_id` is excluded. */
export function fingerprintMcpWriteArgs(
  toolName: string,
  businessInput: unknown,
): string {
  return createHash('sha256')
    .update(canonicalize({ tool: toolName, args: businessInput }))
    .digest('hex');
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    const elements = value.map(canonicalize).sort();
    return `[${elements.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
