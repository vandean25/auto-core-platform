import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_SERVER_IMPLEMENTATION } from './mcp.constants.js';
import { MCP_TOOL_NAMES_WITH_COMPLIANCE } from './mcp-read-tool-catalog.aut605.js';
import type { McpToolNameWithCompliance } from './mcp-read-tool-catalog.aut605.js';
import { McpToolHandlerComplianceWrapper } from './mcp-tool-handler.compliance-wrapper.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { MCP_TOOL_DESCRIPTIONS_WITH_COMPLIANCE } from './mcp-tool-descriptions.merged.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.merged.js';
import {
  MCP_REGISTERED_TOOL_INPUT_SCHEMAS,
  type McpServerSessionContext,
} from './mcp-server.factory.js';
import { withWriteToolInputShapes } from './mcp-server.write-tool-input.js';
import type { McpComplianceReadToolName } from './mcp-read-tool-catalog.aut605.js';
import * as complianceSchemas from './mcp-tool-schemas.compliance-reads.js';
import type { z } from 'zod';

type McpRegisterToolInputSchema = z.ZodTypeAny | Record<string, z.ZodTypeAny>;

const COMPLIANCE_REGISTERED_INPUT_SCHEMAS: Record<
  McpComplianceReadToolName,
  McpRegisterToolInputSchema
> = {
  check_contact_permission:
    complianceSchemas.checkContactPermissionInputSchema.shape,
  list_gewaehrleistung_due:
    complianceSchemas.listGewaehrleistungDueInputSchema.shape,
  list_tyre_sets: complianceSchemas.listTyreSetsInputSchema.shape,
  list_warranty_claims: complianceSchemas.listWarrantyClaimsInputSchema.shape,
};

const REGISTERED_TOOL_INPUT_SCHEMAS: Record<
  McpToolNameWithCompliance,
  McpRegisterToolInputSchema
> = {
  ...withWriteToolInputShapes(MCP_REGISTERED_TOOL_INPUT_SCHEMAS),
  ...COMPLIANCE_REGISTERED_INPUT_SCHEMAS,
};

export type { McpServerSessionContext };

export function createMcpServerWithComplianceReads(
  toolHandler: McpToolHandlerComplianceWrapper,
  session: McpServerSessionContext,
): McpServer {
  const server = new McpServer(MCP_SERVER_IMPLEMENTATION, {
    capabilities: { tools: {} },
  });

  for (const toolName of MCP_TOOL_NAMES_WITH_COMPLIANCE) {
    server.registerTool(
      toolName,
      {
        description: MCP_TOOL_DESCRIPTIONS_WITH_COMPLIANCE[toolName],
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
