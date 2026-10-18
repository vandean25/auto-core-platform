import { randomUUID } from 'node:crypto';
import type { McpWriteToolName } from './mcp.constants.js';
import type {
  McpWriteCommandClaim,
  McpWriteCommandIdempotencyService,
} from './mcp-write-command-idempotency.service.js';
import {
  fingerprintMcpWriteArgs,
  type ParsedMcpWriteInput,
} from './mcp-write-command-idempotency.util.js';
import type { McpWriteToolContext, McpWriteToolResult } from './mcp-write-pipeline.service.js';

export type McpWriteCommandGate =
  | { kind: 'none' }
  | {
      kind: 'claimed';
      claim: McpWriteCommandClaim;
      idempotencyMeta: { command_id: string; args_fingerprint: string };
    }
  | { kind: 'replay'; result: McpWriteToolResult };

export async function resolveMcpWriteCommandGate(
  commandIdempotency: McpWriteCommandIdempotencyService,
  input: {
    parsed: ParsedMcpWriteInput;
    toolName: McpWriteToolName;
    workInput: Record<string, unknown>;
    context: McpWriteToolContext;
    traceId: string | undefined;
  },
): Promise<McpWriteCommandGate> {
  const { commandId, dryRun } = input.parsed;
  if (dryRun || !commandId) {
    return { kind: 'none' };
  }
  const originalTraceId = input.traceId ?? randomUUID();
  const argsFingerprint = fingerprintMcpWriteArgs(
    input.toolName,
    input.workInput,
  );
  const gate = await commandIdempotency.beginOrReplay({
    commandId,
    toolName: input.toolName,
    argsFingerprint,
    context: input.context,
    originalTraceId,
  });
  if (gate.kind === 'replay') {
    return { kind: 'replay', result: gate.result };
  }
  return {
    kind: 'claimed',
    claim: gate.claim,
    idempotencyMeta: {
      command_id: commandId,
      args_fingerprint: argsFingerprint,
    },
  };
}
