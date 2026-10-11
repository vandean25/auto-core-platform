import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_TOOL_NAMES,
  MCP_SERVER_IMPLEMENTATION,
  type McpToolName,
} from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import type { z } from 'zod';
import * as schemas from './mcp-tool-schemas.js';

type McpRegisterToolInputSchema = z.ZodTypeAny | Record<string, z.ZodTypeAny>;

const TOOL_INPUT_SCHEMAS: Record<McpToolName, McpRegisterToolInputSchema> = {
  search_customers: schemas.searchCustomersInputSchema.shape,
  get_customer: schemas.getCustomerInputSchema.shape,
  get_vehicle: schemas.getVehicleInputSchema.shape,
  search_vehicles: schemas.searchVehiclesInputSchema.shape,
  list_workshop_orders: schemas.listWorkshopOrdersInputSchema.shape,
  get_workshop_order: schemas.getWorkshopOrderInputSchema.shape,
  search_parts: schemas.searchPartsInputSchema.shape,
  get_stock_level: schemas.getStockLevelBaseSchema.shape,
  get_vehicle_stock_age_report:
    schemas.getVehicleStockAgeReportInputSchema.shape,
  get_vehicle_stock_margin_report:
    schemas.getVehicleStockMarginReportInputSchema.shape,
  list_invoices: schemas.listInvoicesBaseSchema.shape,
  get_invoice: schemas.getInvoiceInputSchema.shape,
  list_bays: schemas.listBaysInputSchema.shape,
  list_bins: schemas.listBinsInputSchema.shape,
  list_workshop_tasks: schemas.listWorkshopTasksInputSchema.shape,
  whoami: schemas.whoamiInputSchema.shape,
  get_capabilities: schemas.getCapabilitiesInputSchema.shape,
  list_audit_events: schemas.listAuditEventsBaseSchema.shape,
  get_entity_history: schemas.getEntityHistoryInputSchema.shape,
  get_agent_action: schemas.getAgentActionInputSchema.shape,
  list_agent_actions: schemas.listAgentActionsBaseSchema.shape,
  get_vehicle_history: schemas.getVehicleHistoryInputSchema.shape,
  list_documents: schemas.listDocumentsBaseSchema.shape,
  get_document_pdf: schemas.getDocumentPdfInputSchema.shape,
  draft_workshop_order: schemas.mcpWriteToolInputSchemas.draft_workshop_order,
  reserve_part: schemas.mcpWriteToolInputSchemas.reserve_part,
  release_reservation: schemas.mcpWriteToolInputSchemas.release_reservation,
  propose_line_item: schemas.mcpWriteToolInputSchemas.propose_line_item,
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
