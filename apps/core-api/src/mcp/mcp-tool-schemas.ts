import { z } from 'zod';
import { MCP_READ_TOOL_NAMES, MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';

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

export const getStockLevelBaseSchema = z.object({
  catalog_item_id: uuidSchema.optional(),
  sku: z.string().min(1).optional(),
});

export const getStockLevelInputSchema = getStockLevelBaseSchema.refine(
  (value) => Boolean(value.catalog_item_id || value.sku),
  {
    message: 'catalog_item_id or sku is required',
  },
);

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

const workshopOrderPurposeSchema = z.enum(['CUSTOMER_REPAIR', 'STOCK_PREP']);
const workshopOrderDraftStatusSchema = z.literal('SCHEDULED');

export const draftWorkshopOrderInputSchema = z.object({
  customer_id: uuidSchema.optional(),
  vehicle_id: uuidSchema,
  purpose: workshopOrderPurposeSchema.optional(),
  status: workshopOrderDraftStatusSchema,
  bay_id: uuidSchema.optional(),
  mechanic_id: uuidSchema.optional(),
  scheduled_start_at: z.string().optional(),
  scheduled_end_at: z.string().optional(),
  odometer: z.number().int().min(0).optional(),
  fuel_level: z.number().int().min(0).max(100).optional(),
  reported_issue: z.string().optional(),
  notes: z.string().optional(),
});

export const reservePartInputSchema = z.object({
  workshop_task_line_item_id: uuidSchema,
  quantity: z.number().min(0.001),
  location_id: uuidSchema,
});

export const releaseReservationInputSchema = z.object({
  reservation_id: uuidSchema,
  return_location_id: uuidSchema.optional(),
});

export const proposeLineItemInputSchema = z.object({
  workshop_order_id: uuidSchema,
  workshop_task_id: uuidSchema,
  expected_line_items_version: z.number().int().min(0),
  line_item: z.object({
    type: z.enum(['PART', 'LABOR']),
    item_no: z.string().min(1),
    description: z.string().min(1),
    quantity: z.number().min(0.001),
    unit_price_cents: z.number().int().min(0),
    labor_operation_id: uuidSchema.optional(),
  }),
});

export const mcpWriteToolInputSchemas: Record<
  (typeof MCP_WRITE_TOOL_NAMES)[number],
  z.ZodTypeAny
> = {
  draft_workshop_order: draftWorkshopOrderInputSchema,
  reserve_part: reservePartInputSchema,
  release_reservation: releaseReservationInputSchema,
  propose_line_item: proposeLineItemInputSchema,
};
