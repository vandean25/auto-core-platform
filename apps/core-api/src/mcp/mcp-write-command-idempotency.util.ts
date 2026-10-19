import { createHash } from 'node:crypto';
const COMMAND_ID_FIELD = 'command_id';
const DRY_RUN_FIELD = 'dry_run';

export type ParsedMcpWriteInput = {
  commandId?: string;
  dryRun: boolean;
  businessInput: Record<string, unknown>;
};

export function parseMcpWriteCommandInput(input: unknown): ParsedMcpWriteInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { businessInput: {}, dryRun: false };
  }
  const record = { ...(input as Record<string, unknown>) };
  const commandId = record[COMMAND_ID_FIELD];
  delete record[COMMAND_ID_FIELD];
  const dryRun = record[DRY_RUN_FIELD] === true;
  delete record[DRY_RUN_FIELD];
  return {
    commandId: typeof commandId === 'string' ? commandId : undefined,
    dryRun,
    businessInput: record,
  };
}

/** Canonical fingerprint for tool args; `command_id` is excluded. */
export function fingerprintMcpWriteArgs(
  toolName: string,
  businessInput: unknown,
): string {
  const args = stripDryRunField(businessInput);
  return createHash('sha256')
    .update(canonicalize({ tool: toolName, args }))
    .digest('hex');
}

function stripDryRunField(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const record = { ...(value as Record<string, unknown>) };
  delete record[DRY_RUN_FIELD];
  return record;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    const elements = value.map(canonicalize);
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
