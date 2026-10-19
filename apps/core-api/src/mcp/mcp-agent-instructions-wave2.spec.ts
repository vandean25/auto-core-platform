import { readFileSync } from 'node:fs';
import { MCP_TOOL_NAMES_WITH_WAVE2 } from './mcp-read-wave2-catalog.js';
import { assertToolCatalogMatchesRegistry } from './mcp-agent-instructions-wave2.spec.support.js';

describe('MCP agent instructions (AUT-615 wave 2 reads)', () => {
  it('documents every registered MCP tool including wave 2 reads', () => {
    const instructions = readFileSync(
      new URL('./AGENTS.md', import.meta.url),
      'utf8',
    );
    expect(() =>
      assertToolCatalogMatchesRegistry(instructions, MCP_TOOL_NAMES_WITH_WAVE2),
    ).not.toThrow();
  });
});
