import {
  MCP_READ_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
} from './mcp.constants.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.merged.js';
import {
  MCP_COMPLIANCE_READ_TOOL_NAMES,
  MCP_READ_TOOL_NAMES_WITH_COMPLIANCE,
  MCP_TOOL_NAMES_WITH_COMPLIANCE,
} from './mcp-read-tool-catalog.aut605.js';

describe('AUT-605 MCP read tool catalog', () => {
  it('extends the core read registry without editing mcp.constants.ts', () => {
    expect(MCP_READ_TOOL_NAMES_WITH_COMPLIANCE).toEqual([
      ...MCP_READ_TOOL_NAMES,
      ...MCP_COMPLIANCE_READ_TOOL_NAMES,
    ]);
    expect(MCP_TOOL_NAMES_WITH_COMPLIANCE).toEqual([
      ...MCP_READ_TOOL_NAMES_WITH_COMPLIANCE,
      ...MCP_WRITE_TOOL_NAMES,
    ]);
  });

  it('publishes merged output schemas for every compliance read tool', () => {
    for (const toolName of MCP_COMPLIANCE_READ_TOOL_NAMES) {
      expect(mcpToolOutputSchemas[toolName]).toBeDefined();
    }
  });
});
