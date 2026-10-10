import { z } from 'zod';
import {
  AGENT_ACTION_STATUSES,
  AGENT_ACTION_TIERS,
} from '../agent-action-log/agent-action-log.types.js';
import { TRACE_ID_UUID_REGEX } from '../common/services/trace-id.util.js';
import {
  MCP_MAX_PAGE_SIZE,
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
} from './mcp.constants.js';
import {
  decodeMcpCursor,
  decodeMcpKeysetCursor,
  normalizeMcpRangeEnd,
  normalizeMcpRangeStart,
} from './mcp-output.util.js';

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

/** AUT-455 contract: camelCase `pageSize` and a keyset `cursor` from `meta.next_cursor`. */
const pageSizeCamelSchema = z
  .number()
  .int()
  .min(1)
  .max(MCP_MAX_PAGE_SIZE)
  .optional();

const keysetCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor is invalid')
  .refine(
    (cursor) => decodeMcpKeysetCursor(cursor) !== null,
    'cursor is invalid',
  );

const traceIdSchema = z
  .string()
  .regex(TRACE_ID_UUID_REGEX, 'trace_id must be a UUID');

const isoDateOrDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/,
    'must be an ISO-8601 date or date-time',
  )
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    'must be an ISO-8601 date or date-time',
  );

const auditEntityTypeSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
    'entity_type must be a model name such as Customer',
  );

const auditEntityIdSchema = z.string().trim().min(1).max(128);

const orderedRangeOptions = {
  message: 'from must not be after to',
  path: ['from'],
};

function isOrderedRange(value: { from?: string; to?: string }): boolean {
  if (value.from === undefined || value.to === undefined) {
    return true;
  }
  return (
    Date.parse(normalizeMcpRangeStart(value.from)) <=
    Date.parse(normalizeMcpRangeEnd(value.to))
  );
}

/** The base object is the registered MCP shape; the refined schema is what the handler parses. */
export const listAuditEventsBaseSchema = z.object({
  entity_type: auditEntityTypeSchema.optional(),
  entity_id: auditEntityIdSchema.optional(),
  actor: uuidSchema.optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE']).optional(),
  from: isoDateOrDateTimeSchema.optional(),
  to: isoDateOrDateTimeSchema.optional(),
  trace_id: traceIdSchema.optional(),
  pageSize: pageSizeCamelSchema,
  cursor: keysetCursorSchema.optional(),
});

export const listAuditEventsInputSchema = listAuditEventsBaseSchema.refine(
  isOrderedRange,
  orderedRangeOptions,
);

export const getEntityHistoryInputSchema = z.object({
  entity_type: auditEntityTypeSchema,
  entity_id: auditEntityIdSchema,
  pageSize: pageSizeCamelSchema,
  cursor: keysetCursorSchema.optional(),
});

export const getAgentActionInputSchema = z.object({
  trace_id: traceIdSchema,
  pageSize: pageSizeCamelSchema,
  cursor: keysetCursorSchema.optional(),
});

export const listAgentActionsBaseSchema = z.object({
  agent: z.string().trim().min(1).max(160).optional(),
  tool: z.enum(MCP_TOOL_NAMES).optional(),
  tier: z.enum(AGENT_ACTION_TIERS).optional(),
  status: z.enum(AGENT_ACTION_STATUSES).optional(),
  from: isoDateOrDateTimeSchema.optional(),
  to: isoDateOrDateTimeSchema.optional(),
  pageSize: pageSizeCamelSchema,
  cursor: keysetCursorSchema.optional(),
});

export const listAgentActionsInputSchema = listAgentActionsBaseSchema.refine(
  isOrderedRange,
  orderedRangeOptions,
);

/** AUT-456 invoice reads: filters take identifiers and issue dates, paging is the AUT-455 keyset contract. */
const invoiceStatusSchema = z.enum([
  'DRAFT',
  'FINALIZED',
  'ISSUED',
  'PAID',
  'CANCELLED',
]);

export const listInvoicesBaseSchema = z.object({
  status: invoiceStatusSchema.optional(),
  customer_id: uuidSchema.optional(),
  order_id: uuidSchema
    .optional()
    .describe('Workshop order or sales order ID the invoice was created from'),
  from: z
    .string()
    .date()
    .optional()
    .describe('Issue date, YYYY-MM-DD, inclusive'),
  to: z
    .string()
    .date()
    .optional()
    .describe('Issue date, YYYY-MM-DD, inclusive'),
  number: z.string().trim().min(1).max(64).optional(),
  pageSize: pageSizeCamelSchema,
  cursor: keysetCursorSchema.optional(),
});

export const listInvoicesInputSchema = listInvoicesBaseSchema.refine(
  isOrderedRange,
  orderedRangeOptions,
);

export const getInvoiceInputSchema = z.object({
  invoice_id: uuidSchema,
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
  list_invoices: listInvoicesInputSchema,
  get_invoice: getInvoiceInputSchema,
  list_bays: listBaysInputSchema,
  list_bins: listBinsInputSchema,
  list_workshop_tasks: listWorkshopTasksInputSchema,
  whoami: whoamiInputSchema,
  get_capabilities: getCapabilitiesInputSchema,
  list_audit_events: listAuditEventsInputSchema,
  get_entity_history: getEntityHistoryInputSchema,
  get_agent_action: getAgentActionInputSchema,
  list_agent_actions: listAgentActionsInputSchema,
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
