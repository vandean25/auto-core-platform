import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import {
  MCP_TOOL_CAPABILITY,
  type McpCapabilityGateService,
} from './mcp-capability-gate.service.js';

type RequestId = string | number;
type ListedTool = { name: string };

function listRequestId(message: JSONRPCMessage): RequestId | undefined {
  return 'method' in message &&
    message.method === 'tools/list' &&
    'id' in message
    ? message.id
    : undefined;
}

function withoutHidden(
  message: JSONRPCMessage,
  hidden: ReadonlySet<string>,
): JSONRPCMessage {
  if (!('result' in message)) return message;
  const tools = (message.result as { tools?: ListedTool[] }).tools;
  if (!tools) return message;
  const visible = tools.filter((tool) => !hidden.has(tool.name));
  return { ...message, result: { ...message.result, tools: visible } };
}

/** Failing to read the capabilities hides every gated tool rather than showing them. */
async function hiddenNames(
  gate: McpCapabilityGateService,
): Promise<ReadonlySet<string>> {
  try {
    return await gate.hiddenToolNames();
  } catch {
    return new Set(Object.keys(MCP_TOOL_CAPABILITY));
  }
}

/**
 * Removes capability-gated tools from `tools/list` replies. It runs per
 * request, so a capability change shows on the next list. Calls are not
 * touched: they reach the tool, whose gate refuses with `CAPABILITY_UNAVAILABLE`.
 * Call after `server.connect(transport)`.
 */
export function installCapabilityToolFilter(
  transport: Transport,
  gate: McpCapabilityGateService,
): void {
  const deliver = transport.onmessage?.bind(transport);
  const send = transport.send.bind(transport);
  const hiddenByRequest = new Map<RequestId, ReadonlySet<string>>();

  transport.onmessage = (message, extra) => {
    const id = listRequestId(message);
    if (id === undefined) return deliver?.(message, extra);
    void hiddenNames(gate).then((hidden) => {
      hiddenByRequest.set(id, hidden);
      deliver?.(message, extra);
    });
  };
  transport.send = (message, options) => {
    const id = 'id' in message ? message.id : undefined;
    const hidden = id === undefined ? undefined : hiddenByRequest.get(id);
    if (!hidden) return send(message, options);
    hiddenByRequest.delete(id as RequestId);
    return send(withoutHidden(message, hidden), options);
  };
}

/** Connects the server, then hides capability-gated tools from its 	ools/list replies. */
export async function connectWithCapabilityFilter(
  server: { connect(transport: Transport): Promise<void> },
  transport: Transport,
  gate: McpCapabilityGateService,
): Promise<void> {
  await server.connect(transport);
  installCapabilityToolFilter(transport, gate);
}
