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
  loanerAvailabilityCursorPositionSchema,
  workshopSlotCursorPositionSchema,
} from './mcp-availability-read.mapper.js';
import {
  MCP_CATALOG_ITEM_TYPES,
  mcpCatalogItemPositionSchema,
  mcpMarginRulePositionSchema,
  mcpPriceListPositionSchema,
} from './mcp-catalog-read.mapper.js';
import {
  MCP_DOCUMENT_ENTITY_TYPES,
  MCP_DOCUMENT_TYPES,
  isMcpDocumentId,
} from './mcp-document-read.mapper.js';
import {
  decodeMcpCursor,
  decodeMcpKeysetCursor,
  decodeMcpPositionCursor,
  normalizeMcpRangeEnd,
  normalizeMcpRangeStart,
} from './mcp-output.util.js';
import { MCP_ESTIMATE_STATUS_FILTERS } from './mcp-workshop-order-read.mapper.js';
import {
  decodeMcpVehicleContextCursor,
  MCP_VEHICLE_CONTEXT_SECTIONS,
} from './mcp-vehicle-context.mapper.js';
import { proposeWorkshopBookingInputSchema } from '../workshop/workshop-booking-package.schema.js';
import {
  proposeMechanicFindingInputSchema,
  requestWorkshopMediaUploadInputSchema,
} from '../mechanic/mechanic-finding-propose.schema.js';
import { proposePurchaseOrderInputSchema } from '../purchase/purchase-propose-draft.schema.js';
import { generateWeeklyReportPdfInputSchema } from '../reports/weekly-report/weekly-report-mcp.schema.js';
import { proposeWorkshopOrderCompletionInputSchema } from '../workshop/workshop-order-completion.schema.js';
import { proposeInvoiceDraftFromOrderInputSchema } from '../invoices/invoice-workshop-draft-propose.schema.js';
import { proposeEstimateSendInputSchema } from '../workshop/workshop-estimate-send-propose.schema.js';
import {
  dryRunArg,
  dryRunArgSchema,
  withMcpWriteDryRunInput,
} from './mcp-write-dry-run.schema.js';

export { dryRunArg, dryRunArgSchema };

const pageSchema = z.number().int().min(1).optional();
const uuidSchema = z.string().uuid();

/** AUT-429 contract: camelCase `pageSize` on every paging MCP tool input. */
const pageSizeCamelSchema = z
  .number()
  .int()
  .min(1)
  .max(MCP_MAX_PAGE_SIZE)
  .optional();

export const searchCustomersInputSchema = z.object({
  search: z.string().min(1).optional(),
  page: pageSchema,
  pageSize: pageSizeCamelSchema,
});

export const searchVehiclesInputSchema = z.object({
  search: z.string().min(1).optional(),
  page: pageSchema,
  pageSize: pageSizeCamelSchema,
});

export const getVehicleInputSchema = z.object({
  vehicle_id: uuidSchema,
});

export const getVehicleListingStatusInputSchema = z.object({
  vehicle_id: uuidSchema,
});

const workshopOrderStatusSchema = z.enum([
  'SCHEDULED',
  'INTAKE',
  'IN_PROGRESS',
  'COMPLETED',
  'INVOICED',
]);

const bothOrNoneRangeOptions = {
  message: 'from and to must be given together',
  path: ['from'],
};

function isBothOrNoneRange(value: { from?: string; to?: string }): boolean {
  return (value.from === undefined) === (value.to === undefined);
}

function isOrderedSiteLocalRange(value: {
  from?: string;
  to?: string;
}): boolean {
  if (value.from === undefined || value.to === undefined) {
    return true;
  }
  return value.from <= value.to;
}

export const listWorkshopOrdersBaseSchema = z.object({
  search: z.string().min(1).optional(),
  customer_id: uuidSchema.optional(),
  status: z.array(workshopOrderStatusSchema).min(1).optional(),
  estimate_status: z.enum(MCP_ESTIMATE_STATUS_FILTERS).optional(),
  scheduled_from: z
    .string()
    .date()
    .optional()
    .describe(
      'Scheduled start date, YYYY-MM-DD, inclusive, in the site timezone',
    ),
  scheduled_to: z
    .string()
    .date()
    .optional()
    .describe(
      'Scheduled start date, YYYY-MM-DD, inclusive, in the site timezone',
    ),
  sent_from: z
    .string()
    .date()
    .optional()
    .describe(
      'Estimate sent date on the current version, YYYY-MM-DD, inclusive, in the site timezone',
    ),
  sent_to: z
    .string()
    .date()
    .optional()
    .describe(
      'Estimate sent date on the current version, YYYY-MM-DD, inclusive, in the site timezone',
    ),
  page: pageSchema,
  pageSize: pageSizeCamelSchema,
});

export const listWorkshopOrdersInputSchema = listWorkshopOrdersBaseSchema
  .refine(
    (value) =>
      isBothOrNoneRange({
        from: value.scheduled_from,
        to: value.scheduled_to,
      }),
    { ...bothOrNoneRangeOptions, path: ['scheduled_from'] },
  )
  .refine(
    (value) => isBothOrNoneRange({ from: value.sent_from, to: value.sent_to }),
    { ...bothOrNoneRangeOptions, path: ['sent_from'] },
  )
  .refine(
    (value) =>
      isOrderedSiteLocalRange({
        from: value.scheduled_from,
        to: value.scheduled_to,
      }),
    {
      message: 'scheduled_from must not be after scheduled_to',
      path: ['scheduled_from'],
    },
  )
  .refine(
    (value) =>
      isOrderedSiteLocalRange({ from: value.sent_from, to: value.sent_to }),
    { message: 'sent_from must not be after sent_to', path: ['sent_from'] },
  );

export const getWorkshopOrderInputSchema = z.object({
  workshop_order_id: uuidSchema,
});

export const searchPartsInputSchema = z.object({
  query: z.string().min(1),
  workshop_order_id: uuidSchema.optional(),
  page: pageSchema,
  pageSize: pageSizeCamelSchema,
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

export const listBaysInputSchema = z.object({
  page: pageSchema,
  pageSize: pageSizeCamelSchema,
});

export const listBinsInputSchema = z.object({
  page: pageSchema,
  pageSize: pageSizeCamelSchema,
});

export const listWorkshopTasksInputSchema = z.object({
  page: pageSchema,
  pageSize: pageSizeCamelSchema,
});

export const whoamiInputSchema = z.object({});

/** Offset cursor from encodeMcpCursor, for static lists: the tool catalog and the site directory. */
const offsetCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor is invalid')
  .refine((cursor) => decodeMcpCursor(cursor) !== null, 'cursor is invalid');

/** AUT-454 contract: camelCase `pageSize` and an opaque `cursor`. */
export const getCapabilitiesInputSchema = z.object({
  pageSize: z.number().int().min(1).max(MCP_MAX_PAGE_SIZE).optional(),
  cursor: offsetCursorSchema.optional(),
});

/** AUT-455 contract: camelCase `pageSize` and a keyset `cursor` from `meta.next_cursor`. */

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

/**
 * AUT-459 customer and vehicle history. The order list is a keyset page with
 * its own parameters, so it does not share the top-level pageSize and cursor.
 */
const orderHistoryPageFields = {
  orders_page_size: pageSizeCamelSchema.describe(
    'Orders per page: default 10, max 25',
  ),
  orders_cursor: keysetCursorSchema
    .optional()
    .describe('Cursor from orders.meta.next_cursor'),
};

export const getCustomerInputSchema = z.object({
  customer_id: uuidSchema,
  ...orderHistoryPageFields,
});

export const getVehicleHistoryInputSchema = z.object({
  vehicle_id: uuidSchema,
  ...orderHistoryPageFields,
});

const vehicleContextSectionSchema = z.enum(MCP_VEHICLE_CONTEXT_SECTIONS);

const vehicleContextCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor is invalid')
  .refine(
    (cursor) => decodeMcpVehicleContextCursor(cursor) !== null,
    'cursor is invalid',
  );

/** AUT-513 compact vehicle work context with a finite section allowlist. */
export const getVehicleContextInputSchema = z.object({
  vehicle_id: uuidSchema,
  sections: z
    .array(vehicleContextSectionSchema)
    .min(1)
    .optional()
    .describe(
      'identity, open_workshop, inspections, documents, warranty_claims, warranty_periods. Default: all',
    ),
  pageSize: pageSizeCamelSchema,
  cursor: vehicleContextCursorSchema
    .optional()
    .describe('Cursor from a section meta.next_cursor'),
});

/** AUT-459 document reads: a document ID is `<type>:<uuid>`, and list paging is the AUT-455 keyset contract. */
const documentTypeSchema = z.enum(MCP_DOCUMENT_TYPES);
const documentEntityTypeSchema = z.enum(MCP_DOCUMENT_ENTITY_TYPES);

/** The base object is the registered MCP shape; the refined schema is what the handler parses. */
export const listDocumentsBaseSchema = z.object({
  entity_type: documentEntityTypeSchema
    .optional()
    .describe(
      'customer or vehicle lists its documents; invoice, credit_note, workshop_order, or vehicle_sale lists the one record',
    ),
  entity_id: uuidSchema.optional(),
  type: documentTypeSchema
    .optional()
    .describe(
      'invoice, credit_note, workshop_order (job card), or vehicle_sale_contract (Kaufvertrag)',
    ),
  pageSize: pageSizeCamelSchema,
  cursor: keysetCursorSchema.optional(),
});

export const listDocumentsInputSchema = listDocumentsBaseSchema.refine(
  (value) =>
    (value.entity_type === undefined) === (value.entity_id === undefined),
  {
    message: 'entity_type and entity_id must be given together',
    path: ['entity_id'],
  },
);

export const getDocumentPdfInputSchema = z.object({
  id: z.string().refine(isMcpDocumentId, 'id must be <type>:<uuid>'),
});

/**
 * AUT-457 settings reads. The tenant comes from the session and no argument
 * names one, except the legal entity, which must belong to that tenant.
 */
export const getTenantSettingsInputSchema = z.object({});

export const listSitesInputSchema = z.object({
  pageSize: pageSizeCamelSchema.describe('Sites per page: default 10, max 25'),
  cursor: offsetCursorSchema
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

export const getLegalEntityInputSchema = z.object({
  legal_entity_id: uuidSchema
    .optional()
    .describe(
      'Legal entity ID in the session tenant. Omit to read the legal entity of the active site',
    ),
});

/**
 * AUT-458 purchasing reads. Purchase orders are site-scoped like invoices, so their
 * filters take identifiers and order dates. Vendors are tenant-wide master data.
 * Paging is the AUT-455 keyset contract.
 */
const purchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'SENT',
  'PARTIAL',
  'COMPLETED',
]);

export const listPurchaseOrdersBaseSchema = z.object({
  status: purchaseOrderStatusSchema.optional(),
  vendor_id: uuidSchema.optional(),
  part_id: uuidSchema
    .optional()
    .describe('Catalog part ID on at least one order line'),
  from: z
    .string()
    .date()
    .optional()
    .describe('Order date, YYYY-MM-DD, inclusive'),
  to: z
    .string()
    .date()
    .optional()
    .describe('Order date, YYYY-MM-DD, inclusive'),
  pageSize: pageSizeCamelSchema,
  cursor: keysetCursorSchema.optional(),
});

export const listPurchaseOrdersInputSchema =
  listPurchaseOrdersBaseSchema.refine(isOrderedRange, orderedRangeOptions);

export const getPurchaseOrderInputSchema = z.object({
  id: uuidSchema,
});

export const listVendorsInputSchema = z.object({
  pageSize: pageSizeCamelSchema,
  cursor: keysetCursorSchema.optional(),
});

/**
 * AUT-460 catalog and price reads. Lists take pageSize (max 25) and an opaque
 * cursor from meta.next_cursor. The catalog and margin rule cursors are keyed on
 * a sort key rather than a timestamp, so they use the position form.
 */
function positionCursorSchema(position: z.ZodTypeAny) {
  return z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'cursor is invalid')
    .refine(
      (cursor) => position.safeParse(decodeMcpPositionCursor(cursor)).success,
      'cursor is invalid',
    );
}

export const listCatalogItemsInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Matches SKU, name, or EAN for parts; code or description for labor',
    ),
  type: z
    .enum(MCP_CATALOG_ITEM_TYPES)
    .optional()
    .describe(
      'part (default) lists catalog items; labor lists labor operations',
    ),
  active: z
    .boolean()
    .optional()
    .describe(
      'Parts: true excludes superseded items. Labor: is_active. Omit for both',
    ),
  pageSize: pageSizeCamelSchema.describe('Items per page: default 10, max 25'),
  cursor: positionCursorSchema(mcpCatalogItemPositionSchema)
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

export const getCatalogItemInputSchema = z.object({
  id: uuidSchema.describe(
    'Catalog item ID from list_catalog_items (type part)',
  ),
});

export const listPriceListsInputSchema = z.object({
  pageSize: pageSizeCamelSchema.describe(
    'Price lists per page: default 10, max 25',
  ),
  cursor: positionCursorSchema(mcpPriceListPositionSchema)
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

export const listMarginRulesInputSchema = z.object({
  pageSize: pageSizeCamelSchema.describe('Rules per page: default 10, max 25'),
  cursor: positionCursorSchema(mcpMarginRulePositionSchema)
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

/**
 * AUT-461 report reads. The two stock reports share one input contract: `site_id`
 * (default the active site), a `pageSize` with an opaque `cursor`, and a date range.
 * The workshop KPI report takes a period and `site_id`. Paging is the offset cursor
 * of the static-list reads, because the report services page by offset.
 */
const reportSiteIdSchema = uuidSchema
  .optional()
  .describe('Site ID the caller is authorized for. Omit for the active site');

const reportPageSizeSchema = pageSizeCamelSchema.describe(
  'Rows per page: default 10, max 25',
);

export const getVehicleStockAgeReportBaseSchema = z.object({
  from: z
    .string()
    .date()
    .optional()
    .describe(
      'Stock-in date, YYYY-MM-DD, inclusive. Give with to to report the vehicles that came in during the window',
    ),
  to: z
    .string()
    .date()
    .optional()
    .describe('Stock-in date, YYYY-MM-DD, inclusive. Give with from'),
  site_id: reportSiteIdSchema,
  inventory_role: z.enum(['USED', 'NEW', 'DEMO']).optional(),
  stock_status: z.enum(['IN_STOCK', 'RESERVED', 'IN_PREP']).optional(),
  bucket: stockAgeBucketSchema.optional(),
  pageSize: reportPageSizeSchema,
  cursor: offsetCursorSchema
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

export const getVehicleStockAgeReportInputSchema =
  getVehicleStockAgeReportBaseSchema
    .refine(isBothOrNoneRange, bothOrNoneRangeOptions)
    .refine(isOrderedRange, orderedRangeOptions);

export const getVehicleStockMarginReportBaseSchema = z.object({
  from: z.string().date().describe('Invoice date, YYYY-MM-DD, inclusive'),
  to: z.string().date().describe('Invoice date, YYYY-MM-DD, inclusive'),
  site_id: reportSiteIdSchema,
  pageSize: reportPageSizeSchema,
  cursor: offsetCursorSchema
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

export const getVehicleStockMarginReportInputSchema =
  getVehicleStockMarginReportBaseSchema.refine(
    isOrderedRange,
    orderedRangeOptions,
  );

export const getWorkshopKpiReportBaseSchema = z.object({
  from: z
    .string()
    .date()
    .describe('Period start, YYYY-MM-DD, inclusive, in the site timezone'),
  to: z
    .string()
    .date()
    .describe('Period end, YYYY-MM-DD, inclusive, in the site timezone'),
  site_id: reportSiteIdSchema,
});

export const getWorkshopKpiReportInputSchema =
  getWorkshopKpiReportBaseSchema.refine(isOrderedRange, orderedRangeOptions);

const maxReportDaysOptions = {
  message: 'from and to must span at most 366 calendar days',
  path: ['to'],
};

function isWithinMaxReportDays(value: { from: string; to: string }): boolean {
  const days =
    (Date.parse(normalizeMcpRangeEnd(value.to)) -
      Date.parse(normalizeMcpRangeStart(value.from))) /
      86_400_000 +
    1;
  return days <= 366;
}

export const getRevenueReportBaseSchema = z.object({
  from: z
    .string()
    .date()
    .describe('Period start, YYYY-MM-DD, inclusive, in the site timezone'),
  to: z
    .string()
    .date()
    .describe('Period end, YYYY-MM-DD, inclusive, in the site timezone'),
  site_id: reportSiteIdSchema,
  compare_previous: z
    .boolean()
    .optional()
    .describe(
      'When true, include the previous period of the same length ending the day before from',
    ),
});

export const getRevenueReportInputSchema = getRevenueReportBaseSchema
  .refine(isOrderedRange, orderedRangeOptions)
  .refine(isWithinMaxReportDays, maxReportDaysOptions);

/** AUT-461 Pickerl due list: vehicles due within the window, plus every overdue vehicle. */
export const listPickerlDueInputSchema = z.object({
  window: z
    .union([z.literal(30), z.literal(60), z.literal(90)])
    .optional()
    .describe(
      'Days ahead: 30, 60, or 90. Default 30. Overdue vehicles are always listed',
    ),
  pageSize: reportPageSizeSchema,
  cursor: offsetCursorSchema
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

/** AUT-461 NoVA preview: a vehicle and the net price to calculate on, as a EUR decimal string. */
export const getNovaPreviewInputSchema = z.object({
  vehicle_id: uuidSchema,
  net_price_eur: z
    .string()
    .regex(
      /^\d{1,9}(\.\d{1,2})?$/,
      'net_price_eur must be a EUR decimal string',
    )
    .describe(
      'Net vehicle price without VAT, EUR decimal string such as "12000.00"',
    ),
});

/** AUT-512 workshop slot availability for the active site (read-only snapshot). */
export const listWorkshopSlotsInputSchema = z.object({
  from: z.string().min(1).describe('Range start as an ISO-8601 UTC instant'),
  to: z.string().min(1).describe('Range end as an ISO-8601 UTC instant'),
  duration_minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .describe('Required contiguous free time in minutes'),
  bay_id: uuidSchema
    .optional()
    .describe('Optional bay at the active site; omit for all bays'),
  pageSize: reportPageSizeSchema,
  cursor: positionCursorSchema(workshopSlotCursorPositionSchema)
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

/** AUT-512 loaner fleet availability for the active site (read-only snapshot). */
export const listAvailableLoanersInputSchema = z.object({
  from: z.string().min(1).describe('Range start as an ISO-8601 UTC instant'),
  to: z.string().min(1).describe('Range end as an ISO-8601 UTC instant'),
  pageSize: reportPageSizeSchema,
  cursor: positionCursorSchema(loanerAvailabilityCursorPositionSchema)
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

export const mcpToolInputSchemas: Record<
  (typeof MCP_READ_TOOL_NAMES)[number],
  z.ZodTypeAny
> = {
  search_customers: searchCustomersInputSchema,
  get_customer: getCustomerInputSchema,
  search_vehicles: searchVehiclesInputSchema,
  get_vehicle: getVehicleInputSchema,
  get_vehicle_listing_status: getVehicleListingStatusInputSchema,
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
  list_workshop_slots: listWorkshopSlotsInputSchema,
  list_available_loaners: listAvailableLoanersInputSchema,
  whoami: whoamiInputSchema,
  get_capabilities: getCapabilitiesInputSchema,
  list_audit_events: listAuditEventsInputSchema,
  get_entity_history: getEntityHistoryInputSchema,
  get_agent_action: getAgentActionInputSchema,
  list_agent_actions: listAgentActionsInputSchema,
  get_vehicle_history: getVehicleHistoryInputSchema,
  get_vehicle_context: getVehicleContextInputSchema,
  list_documents: listDocumentsInputSchema,
  get_document_pdf: getDocumentPdfInputSchema,
  get_tenant_settings: getTenantSettingsInputSchema,
  list_sites: listSitesInputSchema,
  get_legal_entity: getLegalEntityInputSchema,
  list_purchase_orders: listPurchaseOrdersInputSchema,
  get_purchase_order: getPurchaseOrderInputSchema,
  list_vendors: listVendorsInputSchema,
  get_workshop_kpi_report: getWorkshopKpiReportInputSchema,
  get_revenue_report: getRevenueReportInputSchema,
  list_pickerl_due: listPickerlDueInputSchema,
  get_nova_preview: getNovaPreviewInputSchema,
  list_catalog_items: listCatalogItemsInputSchema,
  get_catalog_item: getCatalogItemInputSchema,
  list_price_lists: listPriceListsInputSchema,
  list_margin_rules: listMarginRulesInputSchema,
};

const workshopOrderPurposeSchema = z.enum(['CUSTOMER_REPAIR', 'STOCK_PREP']);
const workshopOrderDraftStatusSchema = z.literal('SCHEDULED');

const optionalMcpCommandIdSchema = {
  command_id: uuidSchema
    .optional()
    .describe(
      'Client idempotency key for AUTO/PROPOSE writes. Replays return the same committed result or pending action.',
    ),
};

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
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
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
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
  })
  .strict()
  .describe(
    'Reservations use the existing EUR 250 platform amount_max: AUTO at or below the effective policy amount_max and PROPOSE above it.',
  );

export const releaseReservationInputSchema = z
  .object({
    reservation_id: uuidSchema,
    return_location_id: uuidSchema.optional(),
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
  })
  .strict();

export const proposeRegistrationIntakeInputSchema = z
  .object({
    intake_id: uuidSchema,
    vin: z.string().nullable(),
    plate: z.string(),
    holder: z
      .object({
        first_name: z.string(),
        last_name: z.string(),
      })
      .strict(),
    nationalcode: z.string().nullable(),
    first_registration: z.string().nullable(),
    co2: z
      .object({
        value: z.number().int().min(0).max(600),
        cycle: z.enum(['WLTP', 'NEDC']),
      })
      .nullable()
      .optional(),
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.number().int().min(1900).optional(),
    customer_id: uuidSchema.optional(),
    vehicle_id: uuidSchema.optional(),
    ownership_correction: z
      .object({
        expected_customer_id: uuidSchema.nullable(),
        next_customer_id: uuidSchema,
      })
      .strict()
      .optional(),
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
  })
  .strict();

export const proposeLineItemInputSchema = z
  .object({
    workshop_order_id: uuidSchema,
    workshop_task_id: uuidSchema,
    expected_line_items_version: z.number().int().min(0),
    line_item: z
      .object({
        type: z.enum(['PART', 'LABOR', 'FEE']),
        item_no: z.string().min(1),
        description: z.string().min(1),
        quantity: z.number().min(0.001),
        unit_price_cents: z.number().int().min(0),
        labor_operation_id: uuidSchema.optional(),
      })
      .strict()
      .superRefine((line, ctx) => {
        if (line.type === 'FEE' && line.labor_operation_id !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'FEE lines cannot reference labor_operation_id',
          });
        }
      }),
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
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
  propose_registration_intake: proposeRegistrationIntakeInputSchema,
  propose_workshop_booking: withMcpWriteDryRunInput(
    proposeWorkshopBookingInputSchema,
  ),
  propose_purchase_order: withMcpWriteDryRunInput(
    proposePurchaseOrderInputSchema,
  ),
  propose_workshop_order_completion: withMcpWriteDryRunInput(
    proposeWorkshopOrderCompletionInputSchema,
  ),
  propose_invoice_draft_from_order: withMcpWriteDryRunInput(
    proposeInvoiceDraftFromOrderInputSchema,
  ),
  propose_estimate_send: withMcpWriteDryRunInput(
    proposeEstimateSendInputSchema,
  ),
  request_workshop_media_upload: withMcpWriteDryRunInput(
    requestWorkshopMediaUploadInputSchema,
  ),
  propose_mechanic_finding: withMcpWriteDryRunInput(
    proposeMechanicFindingInputSchema,
  ),
  generate_weekly_report_pdf: withMcpWriteDryRunInput(
    generateWeeklyReportPdfInputSchema,
  ),
};
