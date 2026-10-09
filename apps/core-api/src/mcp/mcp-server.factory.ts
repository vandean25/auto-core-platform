import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_TOOL_NAMES,
  MCP_SERVER_IMPLEMENTATION,
  type McpToolName,
} from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import type { z } from 'zod';
import {
  getCustomerInputSchema,
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
} from './mcp-tool-schemas.js';

const TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  search_customers: 'Search customers (tenant-scoped, paged)',
  get_customer: 'Get a customer by id',
  search_vehicles: 'Search vehicles (tenant-scoped, paged)',
  get_vehicle: 'Get a vehicle by id',
  list_workshop_orders: 'List workshop orders for the active site (paged)',
  get_workshop_order: 'Get a workshop order by id (active site)',
  search_parts:
    'Search parts by query; optional workshop_order_id uses workshop catalog context',
  get_stock_level: 'Stock levels for a catalog item id or SKU (active site)',
  get_vehicle_stock_age_report:
    'Read paged dealer stock age and cost basis for the active site',
  get_vehicle_stock_margin_report:
    'Read paged invoiced vehicle margins for the active site and date period',
  list_bays: 'List active bays for the active site (paged)',
  list_bins: 'List bin storage locations for the active site (paged)',
  list_workshop_tasks:
    'List workshop tasks the caller may see, including line IDs (paged)',
  draft_workshop_order:
    'Create a DRAFT/SCHEDULED workshop order (policy-checked, logged)',
  reserve_part:
    'Reserve a catalog part line from a bin; AUTO at or below policy amount_max (EUR 250 platform cap), PROPOSE above amount_max (reversible; counter-tool: release_reservation)',
  release_reservation:
    'Release a parts reservation (counter-tool of reserve_part)',
  propose_line_item:
    'Propose a workshop task line item (never executes; records a pending proposal)',
};

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
  list_bays: listBaysInputSchema.shape,
  list_bins: listBinsInputSchema.shape,
  list_workshop_tasks: listWorkshopTasksInputSchema.shape,
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
        description: TOOL_DESCRIPTIONS[toolName],
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
