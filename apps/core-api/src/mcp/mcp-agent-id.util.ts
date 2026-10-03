const MCP_AGENT_ID_PREFIX = 'mcp:';
export const MCP_AGENT_NAME_MAX_LENGTH = 128;

export function formatMcpAgentId(clientName: string): string {
  const trimmed = clientName.trim().slice(0, MCP_AGENT_NAME_MAX_LENGTH);
  const safeName = trimmed.length > 0 ? trimmed : 'unknown';
  return `${MCP_AGENT_ID_PREFIX}${safeName}`;
}

export function resolveMcpClientNameFromInitializeBody(
  body: unknown,
): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  if (record.method !== 'initialize') {
    return undefined;
  }
  const params = record.params;
  if (!params || typeof params !== 'object') {
    return undefined;
  }
  const clientInfo = (params as Record<string, unknown>).clientInfo;
  if (!clientInfo || typeof clientInfo !== 'object') {
    return undefined;
  }
  const name = (clientInfo as Record<string, unknown>).name;
  return typeof name === 'string' ? name : undefined;
}
