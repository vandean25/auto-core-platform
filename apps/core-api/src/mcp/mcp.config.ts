export function isMcpServerEnabled(): boolean {
  return process.env.MCP_SERVER_ENABLED === 'true';
}
