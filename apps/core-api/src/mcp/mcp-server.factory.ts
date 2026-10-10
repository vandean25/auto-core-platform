import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_TOOL_NAMES,
  MCP_SERVER_IMPLEMENTATION,
  type McpToolName,
} from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import type { z } from 'zod';
import {
  getAgentActionInputSchema,
  getCapabilitiesInputSchema,
  getCustomerInputSchema,
  getEntityHistoryInputSchema,
  getInvoiceInputSchema,
  listAgentActionsBaseSchema,
  listAuditEventsBaseSchema,
  listInvoicesBaseSchema,
  getStockLevelBaseSchema,
  getVehicleStockAgeReportInputSchema,
  getVehicleStockMarginReportInputSchema,
  getVehicleInputSchema,
  getWorkshopOrderInputSchema,
  listWorkshopOrdersInputSchema,
  listBaysInputSchema,
  listBinsInputSchema,
  listWorkshopTasksInputSchema,
  mcpWriteToolInputSchemas,
  searchCustomersInputSchema,
  searchPartsInputSchema,
  searchVehiclesInputSchema,
  whoamiInputSchema,
} from './mcp-tool-schemas.js';

type McpRegisterToolInputSchema = z.ZodTypeAny | Record<string, z.ZodTypeAny>;

const TOOL_INPUT_SCHEMAS: Record<McpToolName, McpRegisterToolInputSchema> = {
  search_customers: searchCustomersInputSchema.shape,
  get_customer: getCustomerInputSchema.shape,
  get_vehicle: getVehicleInputSchema.shape,
  search_vehicles: searchVehiclesInputSchema.shape,
  list_workshop_orders: listWorkshopOrdersInputSchema.shape,
  get_workshop_order: getWorkshopOrderInputSchema.shape,
  search_parts: searchPartsInputSchema.shape,
  get_stock_level: getStockLevelBaseSchema.shape,
  get_vehicle_stock_age_report: getVehicleStockAgeReportInputSchema.shape,
  get_vehicle_stock_margin_report: getVehicleStockMarginReportInputSchema.shape,
  list_invoices: listInvoicesBaseSchema.shape,
  get_invoice: getInvoiceInputSchema.shape,
  list_bays: listBaysInputSchema.shape,
  list_bins: listBinsInputSchema.shape,
  list_workshop_tasks: listWorkshopTasksInputSchema.shape,
  whoami: whoamiInputSchema.shape,
  get_capabilities: getCapabilitiesInputSchema.shape,
  list_audit_events: listAuditEventsBaseSchema.shape,
  get_entity_history: getEntityHistoryInputSchema.shape,
  get_agent_action: getAgentActionInputSchema.shape,
  list_agent_actions: listAgentActionsBaseSchema.shape,
  draft_workshop_order: mcpWriteToolInputSchemas.draft_workshop_order,
  reserve_part: mcpWriteToolInputSchemas.reserve_part,
  release_reservation: mcpWriteToolInputSchemas.release_reservation,
  propose_line_item: mcpWriteToolInputSchemas.propose_line_item,
};

export type McpServerSessionContext = {
  agentId: string;
  onBehalfOfUserId: string;
};

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
        inputSchema: TOOL_INPUT_SCHEMAS[toolName],
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
          structuredContent: result as Record<string, unknown>,
        };
      },
    );
  }

  return server;
}
