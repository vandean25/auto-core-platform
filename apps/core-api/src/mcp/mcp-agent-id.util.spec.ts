import {
  formatMcpAgentId,
  MCP_AGENT_NAME_MAX_LENGTH,
  resolveMcpAgentName,
} from './mcp-agent-id.util.js';

describe('formatMcpAgentId', () => {
  it('truncates long client names', () => {
    const longName = 'a'.repeat(200);
    const agentId = formatMcpAgentId(longName);
    expect(agentId).toBe(`mcp:${'a'.repeat(MCP_AGENT_NAME_MAX_LENGTH)}`);
  });
});

describe('resolveMcpAgentName', () => {
  it('returns the client name from an agent id', () => {
    expect(resolveMcpAgentName('mcp:cursor')).toBe('cursor');
  });

  it('returns null for an id without the MCP prefix', () => {
    expect(resolveMcpAgentName('other:cursor')).toBeNull();
  });
});
