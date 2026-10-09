import { z } from 'zod';
import {
  MCP_MAX_PAGE_SIZE,
  MCP_READ_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
} from './mcp.constants.js';
import { decodeMcpCursor } from './mcp-output.util.js';

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

const stockAgeBucketSchema = z.enum([
  '0_30',
  '31_60',
  '61_90',
  '91_180',
  'over_180',
  'over_90',
]);

export const getVehicleStockAgeReportInputSchema = z.object({
  inventory_role: z.enum(['USED', 'NEW', 'DEMO']).optional(),
  stock_status: z.enum(['IN_STOCK', 'RESERVED', 'IN_PREP']).optional(),
  bucket: stockAgeBucketSchema.optional(),
  page: pageSchema,
  page_size: pageSizeSchema,
});

export const getVehicleStockMarginReportInputSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  page: pageSchema,
  page_size: pageSizeSchema,
});

export const listBaysInputSchema = z.object({
  page: pageSchema,
  page_size: pageSizeSchema,
});

export const listBinsInputSchema = z.object({
  page: pageSchema,
  page_size: pageSizeSchema,
});

export const listWorkshopTasksInputSchema = z.object({
  page: pageSchema,
  page_size: pageSizeSchema,
});

export const whoamiInputSchema = z.object({});

const capabilityCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor is invalid')
  .refine((cursor) => decodeMcpCursor(cursor) !== null, 'cursor is invalid');

/** AUT-454 contract: camelCase `pageSize` and an opaque `cursor`. */
export const getCapabilitiesInputSchema = z.object({
  pageSize: z.number().int().min(1).max(MCP_MAX_PAGE_SIZE).optional(),
  cursor: capabilityCursorSchema.optional(),
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
  get_vehicle_stock_age_report: getVehicleStockAgeReportInputSchema,
  get_vehicle_stock_margin_report: getVehicleStockMarginReportInputSchema,
  list_bays: listBaysInputSchema,
  list_bins: listBinsInputSchema,
  list_workshop_tasks: listWorkshopTasksInputSchema,
  whoami: whoamiInputSchema,
  get_capabilities: getCapabilitiesInputSchema,
};

const workshopOrderPurposeSchema = z.enum(['CUSTOMER_REPAIR', 'STOCK_PREP']);
const workshopOrderDraftStatusSchema = z.literal('SCHEDULED');

export const draftWorkshopOrderInputSchema = z
  .object({
    customer_id: uuidSchema.optional(),
    vehicle_id: uuidSchema,
    purpose: workshopOrderPurposeSchema.optional(),
    status: workshopOrderDraftStatusSchema,
    bay_id: uuidSchema.describe('Required bay ID for a scheduled draft'),
    mechanic_id: uuidSchema.optional(),
    scheduled_start_at: z.string().describe('Required scheduled start time'),
    scheduled_end_at: z.string().describe('Required scheduled end time'),
    odometer: z.number().int().min(0).optional(),
    fuel_level: z.number().int().min(0).max(100).optional(),
    reported_issue: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const reservePartInputSchema = z
  .object({
    workshop_task_line_item_id: uuidSchema.describe(
      'ID of a catalog-backed PART line item on a workshop task; free-text lines are not supported',
    ),
    quantity: z.number().min(0.001),
    location_id: uuidSchema.describe(
      'ID of a bin storage location at the active site',
    ),
  })
  .strict()
  .describe(
    'Reservations use the existing EUR 250 platform amount_max: AUTO at or below the effective policy amount_max and PROPOSE above it.',
  );

export const releaseReservationInputSchema = z
  .object({
    reservation_id: uuidSchema,
    return_location_id: uuidSchema.optional(),
  })
  .strict();

export const proposeLineItemInputSchema = z
  .object({
    workshop_order_id: uuidSchema,
    workshop_task_id: uuidSchema,
    expected_line_items_version: z.number().int().min(0),
    line_item: z
      .object({
        type: z.enum(['PART', 'LABOR']),
        item_no: z.string().min(1),
        description: z.string().min(1),
        quantity: z.number().min(0.001),
        unit_price_cents: z.number().int().min(0),
        labor_operation_id: uuidSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const mcpWriteToolInputSchemas: Record<
  (typeof MCP_WRITE_TOOL_NAMES)[number],
  z.ZodTypeAny
> = {
  draft_workshop_order: draftWorkshopOrderInputSchema,
  reserve_part: reservePartInputSchema,
  release_reservation: releaseReservationInputSchema,
  propose_line_item: proposeLineItemInputSchema,
};
