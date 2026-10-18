import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_TOOL_NAMES,
  MCP_SERVER_IMPLEMENTATION,
  MCP_WRITE_TOOL_NAMES,
  type McpToolName,
  type McpWriteToolName,
} from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.registry.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.registry.js';
import { mcpWriteToolInputSchemas } from './mcp-tool-schemas.write.js';
import {
  MCP_REGISTERED_TOOL_INPUT_SCHEMAS,
  type McpServerSessionContext,
} from './mcp-server.factory.js';
import type { z } from 'zod';

type McpRegisterToolInputSchema = z.ZodTypeAny | Record<string, z.ZodTypeAny>;

function writeToolInputSchema(
  toolName: McpWriteToolName,
): McpRegisterToolInputSchema {
  const schema = mcpWriteToolInputSchemas[toolName] as z.ZodObject<
    Record<string, z.ZodTypeAny>
  >;
  return schema.shape;
}

function registeredToolInputSchema(
  toolName: McpToolName,
): McpRegisterToolInputSchema {
  if ((MCP_WRITE_TOOL_NAMES as readonly McpToolName[]).includes(toolName)) {
    return writeToolInputSchema(toolName as McpWriteToolName);
  }
  return MCP_REGISTERED_TOOL_INPUT_SCHEMAS[toolName];
}

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
        inputSchema: registeredToolInputSchema(toolName),
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
