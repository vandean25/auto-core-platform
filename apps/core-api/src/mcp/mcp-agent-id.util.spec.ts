import {
  formatMcpAgentId,
  MCP_AGENT_NAME_MAX_LENGTH,
} from './mcp-agent-id.util.js';

describe('formatMcpAgentId', () => {
  it('truncates long client names', () => {
    const longName = 'a'.repeat(200);
    const agentId = formatMcpAgentId(longName);
    expect(agentId).toBe(`mcp:${'a'.repeat(MCP_AGENT_NAME_MAX_LENGTH)}`);
  });
});
