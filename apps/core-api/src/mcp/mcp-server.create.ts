import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_TOOL_NAMES, MCP_SERVER_IMPLEMENTATION } from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.registry.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.registry.js';
import { MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';
import { mcpWriteToolInputSchemas } from './mcp-tool-schemas.write.js';
import {
  MCP_REGISTERED_TOOL_INPUT_SCHEMAS,
  type McpServerSessionContext,
} from './mcp-server.factory.js';

export type { McpServerSessionContext };

export function createMcpServer(
  toolHandler: McpToolHandlerService,
  session: McpServerSessionContext,
): McpServer {
  const server = new McpServer(MCP_SERVER_IMPLEMENTATION, {
    capabilities: { tools: {} },
  });

  for (const toolName of MCP_TOOL_NAMES) {
    const inputSchema = (MCP_WRITE_TOOL_NAMES as readonly string[]).includes(
      toolName,
    )
      ? mcpWriteToolInputSchemas[toolName as keyof typeof mcpWriteToolInputSchemas]
          .shape
      : MCP_REGISTERED_TOOL_INPUT_SCHEMAS[toolName];
    server.registerTool(
      toolName,
      {
        description: MCP_TOOL_DESCRIPTIONS[toolName],
        inputSchema,
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
