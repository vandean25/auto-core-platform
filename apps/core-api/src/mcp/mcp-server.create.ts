import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_TOOL_NAMES, MCP_SERVER_IMPLEMENTATION } from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.registry.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.registry.js';
import {
  MCP_REGISTERED_TOOL_INPUT_SCHEMAS,
  type McpServerSessionContext,
} from './mcp-server.factory.js';
import { withWriteToolInputShapes } from './mcp-server.write-tool-input.js';

const REGISTERED_TOOL_INPUT_SCHEMAS = withWriteToolInputShapes(
  MCP_REGISTERED_TOOL_INPUT_SCHEMAS,
);

export type { McpServerSessionContext };

export function createMcpServer(
  toolHandler: McpToolHandlerService,
  session: McpServerSessionContext,
): McpServer {
  const server = new McpServer(MCP_SERVER_IMPLEMENTATION, {
    capabilities: { tools: {} },
  });

  for (const toolName of MCP_TOOL_NAMES) {
    server.registerTool(
      toolName,
      {
        description: MCP_TOOL_DESCRIPTIONS[toolName],
        inputSchema: REGISTERED_TOOL_INPUT_SCHEMAS[toolName],
        outputSchema: mcpToolOutputSchemas[toolName],
      },
      async (args) => {
        const result = await toolHandler.executeTool(toolName, args, {
          agentId: session.agentId,
          onBehalfOfUserId: session.onBehalfOfUserId,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
          structuredContent: toMcpJsonObject(result),
        };
      },
    );
  }

  return server;
}
