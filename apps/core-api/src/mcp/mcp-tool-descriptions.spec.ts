import { MCP_TOOL_NAMES } from './mcp.constants.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import { MCP_TOOL_DESCRIPTIONS_PUBLISHED } from './mcp-tool-descriptions.published.js';
import { MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';

describe('MCP tool descriptions', () => {
  it('describes every registered tool', () => {
    for (const toolName of MCP_TOOL_NAMES) {
      expect(MCP_TOOL_DESCRIPTIONS[toolName]).toEqual(expect.any(String));
      expect(MCP_TOOL_DESCRIPTIONS[toolName].length).toBeGreaterThan(0);
    }
  });

  it('gives every write tool the dry-run hint', () => {
    for (const toolName of MCP_WRITE_TOOL_NAMES) {
      expect(MCP_TOOL_DESCRIPTIONS_PUBLISHED[toolName]).toContain('dry_run');
    }
  });

  it('explains the duplicate check and the consent rule of the customer tools', () => {
    expect(MCP_TOOL_DESCRIPTIONS.propose_customer_create).toContain(
      'DUPLICATE_CUSTOMER',
    );
    expect(MCP_TOOL_DESCRIPTIONS.propose_customer_create).toMatch(/consent/i);
    expect(MCP_TOOL_DESCRIPTIONS.propose_customer_update).toMatch(/consent/i);
  });

  it('describes the customer tools in German and English', () => {
    expect(MCP_TOOL_DESCRIPTIONS.propose_customer_create).toContain('| DE:');
    expect(MCP_TOOL_DESCRIPTIONS.propose_customer_update).toContain('| DE:');
  });
});
