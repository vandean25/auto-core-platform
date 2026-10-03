import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import {
  MCP_READ_TOOL_NAMES,
  MCP_SERVER_IMPLEMENTATION,
  type McpReadToolName,
} from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
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

const TOOL_INPUT_SCHEMAS: Record<McpReadToolName, z.ZodRawShape> = {
  search_customers: {
    search: z.string().optional().describe('Free-text search'),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(25).optional(),
  },
  get_customer: {
    customer_id: z.string().uuid(),
  },
  search_vehicles: {
    search: z.string().optional(),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(25).optional(),
  },
  get_vehicle: {
    vehicle_id: z.string().uuid(),
  },
  list_workshop_orders: {
    search: z.string().optional(),
    customer_id: z.string().uuid().optional(),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(25).optional(),
  },
  get_workshop_order: {
    workshop_order_id: z.string().uuid(),
  },
  search_parts: {
    query: z.string().min(1),
    workshop_order_id: z.string().uuid().optional(),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(25).optional(),
  },
  get_stock_level: {
    catalog_item_id: z.string().uuid().optional(),
    sku: z.string().min(1).optional(),
  },
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
              type: 'text',
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
