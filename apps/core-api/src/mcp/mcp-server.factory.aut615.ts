import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_SERVER_IMPLEMENTATION } from './mcp.constants.js';
import { MCP_TOOL_NAMES_WITH_WAVE2 } from './mcp-read-tool-catalog.aut615.js';
import type { McpToolNameWithWave2 } from './mcp-read-tool-catalog.aut615.js';
import { McpToolHandlerWave2Wrapper } from './mcp-tool-handler.wave2-wrapper.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { MCP_TOOL_DESCRIPTIONS_WITH_WAVE2 } from './mcp-tool-descriptions.merged.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.merged.js';
import {
  MCP_REGISTERED_TOOL_INPUT_SCHEMAS,
  type McpServerSessionContext,
} from './mcp-server.factory.js';
import type { McpComplianceReadToolName } from './mcp-read-tool-catalog.aut605.js';
import type { McpWave2ReadToolName } from './mcp-read-tool-catalog.aut615.js';
import * as complianceSchemas from './mcp-tool-schemas.compliance-reads.js';
import * as wave2Schemas from './mcp-tool-schemas.aut615-reads.js';
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

const WAVE2_REGISTERED_INPUT_SCHEMAS: Record<
  McpWave2ReadToolName,
  McpRegisterToolInputSchema
> = {
  list_loaner_bookings: wave2Schemas.listLoanerBookingsInputSchema.shape,
  list_estimates: wave2Schemas.listEstimatesInputSchema.shape,
  list_order_communications:
    wave2Schemas.listOrderCommunicationsInputSchema.shape,
  get_check_in: wave2Schemas.getCheckInInputSchema.shape,
  get_staff_availability: wave2Schemas.getStaffAvailabilityInputSchema.shape,
};

const REGISTERED_TOOL_INPUT_SCHEMAS: Record<
  McpToolNameWithWave2,
  McpRegisterToolInputSchema
> = {
  ...MCP_REGISTERED_TOOL_INPUT_SCHEMAS,
  ...COMPLIANCE_REGISTERED_INPUT_SCHEMAS,
  ...WAVE2_REGISTERED_INPUT_SCHEMAS,
};

export type { McpServerSessionContext };

export function createMcpServerWithWave2Reads(
  toolHandler: McpToolHandlerWave2Wrapper,
  session: McpServerSessionContext,
): McpServer {
  const server = new McpServer(MCP_SERVER_IMPLEMENTATION, {
    capabilities: { tools: {} },
  });

  for (const toolName of MCP_TOOL_NAMES_WITH_WAVE2) {
    server.registerTool(
      toolName,
      {
        description: MCP_TOOL_DESCRIPTIONS_WITH_WAVE2[toolName],
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
