import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_READ_TOOL_NAMES,
  MCP_SERVER_IMPLEMENTATION,
  type McpReadToolName,
} from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import {
  getCustomerInputSchema,
  getStockLevelBaseSchema,
  getVehicleInputSchema,
  getWorkshopOrderInputSchema,
  listWorkshopOrdersInputSchema,
  searchCustomersInputSchema,
  searchPartsInputSchema,
  searchVehiclesInputSchema,
} from './mcp-tool-schemas.js';

const TOOL_DESCRIPTIONS: Record<McpReadToolName, string> = {
  search_customers: 'Search customers (tenant-scoped, paged)',
  get_customer: 'Get a customer by id',
  search_vehicles: 'Search vehicles (tenant-scoped, paged)',
  get_vehicle: 'Get a vehicle by id',
  list_workshop_orders: 'List workshop orders for the active site (paged)',
  get_workshop_order: 'Get a workshop order by id (active site)',
  search_parts:
    'Search parts by query; optional workshop_order_id uses workshop catalog context',
  get_stock_level: 'Stock levels for a catalog item id or SKU (active site)',
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
} satisfies Record<McpReadToolName, Record<string, unknown>>;

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

  for (const toolName of MCP_READ_TOOL_NAMES) {
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
