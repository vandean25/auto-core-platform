import { z } from 'zod';
import { MCP_READ_TOOL_NAMES } from './mcp.constants.js';

const pageSchema = z.number().int().min(1).optional();
const pageSizeSchema = z.number().int().min(1).max(25).optional();
const uuidSchema = z.string().uuid();

export const searchCustomersInputSchema = z.object({
  search: z.string().min(1).optional(),
  page: pageSchema,
  page_size: pageSizeSchema,
});

export const getCustomerInputSchema = z.object({
  customer_id: uuidSchema,
});

export const searchVehiclesInputSchema = z.object({
  search: z.string().min(1).optional(),
  page: pageSchema,
  page_size: pageSizeSchema,
});

export const getVehicleInputSchema = z.object({
  vehicle_id: uuidSchema,
});

export const listWorkshopOrdersInputSchema = z.object({
  search: z.string().min(1).optional(),
  customer_id: uuidSchema.optional(),
  page: pageSchema,
  page_size: pageSizeSchema,
});

export const getWorkshopOrderInputSchema = z.object({
  workshop_order_id: uuidSchema,
});

export const searchPartsInputSchema = z.object({
  query: z.string().min(1),
  workshop_order_id: uuidSchema.optional(),
  page: pageSchema,
  page_size: pageSizeSchema,
});

export const getStockLevelInputSchema = z
  .object({
    catalog_item_id: uuidSchema.optional(),
    sku: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.catalog_item_id || value.sku), {
    message: 'catalog_item_id or sku is required',
  });

export const mcpToolInputSchemas: Record<
  (typeof MCP_READ_TOOL_NAMES)[number],
  z.ZodTypeAny
> = {
  search_customers: searchCustomersInputSchema,
  get_customer: getCustomerInputSchema,
  search_vehicles: searchVehiclesInputSchema,
  get_vehicle: getVehicleInputSchema,
  list_workshop_orders: listWorkshopOrdersInputSchema,
  get_workshop_order: getWorkshopOrderInputSchema,
  search_parts: searchPartsInputSchema,
  get_stock_level: getStockLevelInputSchema,
};
