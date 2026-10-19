import { mcpWriteToolInputSchemas } from './mcp-tool-schemas.js';
import './mcp-tool-descriptions.bootstrap.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import {
  DRY_RUN_MINIMAL_INPUTS,
  MCP_WRITE_TOOL_NAMES,
  parseRegisteredInput,
} from './mcp-write-dry-run.contract.spec.support.js';

describe('MCP write dry_run input schemas (AUT-612)', () => {
  it('registers dry_run on every write tool input schema exposed by the MCP server', () => {
    for (const toolName of MCP_WRITE_TOOL_NAMES) {
      const minimal = DRY_RUN_MINIMAL_INPUTS[toolName] ?? {};
      const parsed = parseRegisteredInput(toolName, {
        ...minimal,
        dry_run: true,
      });
      expect(parsed).toMatchObject({ dry_run: true });
      expect(() =>
        parseRegisteredInput(toolName, {
          ...minimal,
          dry_run: true,
          definitely_not_a_field: 1,
        }),
      ).toThrow(/unrecognized/i);
      expect(
        mcpWriteToolInputSchemas[toolName].parse({ ...minimal, dry_run: true }),
      ).toEqual(parsed);
    }
  });

  it('every write tool registration description mentions dry_run', () => {
    for (const toolName of MCP_WRITE_TOOL_NAMES) {
      expect(MCP_TOOL_DESCRIPTIONS[toolName]).toMatch(/dry_run/i);
    }
  });
});
