import { MCP_TOOL_NAMES, MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';
import { MCP_REGISTERED_TOOL_INPUT_SCHEMAS } from './mcp-server.factory.js';

describe('MCP registered tool input schemas', () => {
  it('registers an input schema for every tool', () => {
    for (const toolName of MCP_TOOL_NAMES) {
      expect(MCP_REGISTERED_TOOL_INPUT_SCHEMAS[toolName]).toBeDefined();
    }
  });

  it('registers the customer proposal tools with a closed schema', () => {
    const schema = MCP_REGISTERED_TOOL_INPUT_SCHEMAS.propose_customer_create as {
      safeParse: (value: unknown) => { success: boolean };
    };

    expect(
      schema.safeParse({
        customer_type: 'PRIVATE',
        first_name: 'Max',
        last_name: 'Mustermann',
        idempotency_key: 'aut613-create-1',
        contact_email_ok: true,
      }).success,
    ).toBe(false);
  });

  it('gives every write tool a dry_run argument', () => {
    for (const toolName of MCP_WRITE_TOOL_NAMES) {
      expect(MCP_REGISTERED_TOOL_INPUT_SCHEMAS[toolName]).toHaveProperty([
        'shape',
        'dry_run',
      ]);
    }
  });
});
