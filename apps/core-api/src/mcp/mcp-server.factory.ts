import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_TOOL_NAMES,
  MCP_SERVER_IMPLEMENTATION,
  type McpToolName,
} from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import {
  draftWorkshopOrderInputSchema,
  getCustomerInputSchema,
  getStockLevelBaseSchema,
  getVehicleStockAgeReportInputSchema,
  getVehicleStockMarginReportInputSchema,
  getVehicleInputSchema,
  getWorkshopOrderInputSchema,
  listWorkshopOrdersInputSchema,
  proposeLineItemInputSchema,
  releaseReservationInputSchema,
  reservePartInputSchema,
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
  draft_workshop_order:
    'Create a DRAFT/SCHEDULED workshop order (policy-checked, dry-run preview, logged)',
  reserve_part:
    'Create an on-hand parts reservation (reversible; counter-tool: release_reservation)',
  release_reservation:
    'Release a parts reservation (counter-tool of reserve_part)',
  propose_line_item:
    'Propose a workshop task line item (never executes; records a pending proposal)',
};

const TOOL_INPUT_SCHEMAS = {
  search_customers: searchCustomersInputSchema.shape,
  get_customer: getCustomerInputSchema.shape,
  search_vehicles: searchVehiclesInputSchema.shape,
  get_vehicle: getVehicleInputSchema.shape,
  list_workshop_orders: listWorkshopOrdersInputSchema.shape,
  get_workshop_order: getWorkshopOrderInputSchema.shape,
  search_parts: searchPartsInputSchema.shape,
  get_stock_level: getStockLevelBaseSchema.shape,
  get_vehicle_stock_age_report: getVehicleStockAgeReportInputSchema.shape,
  get_vehicle_stock_margin_report: getVehicleStockMarginReportInputSchema.shape,
  draft_workshop_order: draftWorkshopOrderInputSchema.shape,
  reserve_part: reservePartInputSchema.shape,
  release_reservation: releaseReservationInputSchema.shape,
  propose_line_item: proposeLineItemInputSchema.shape,
} satisfies Record<McpToolName, Record<string, unknown>>;

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
