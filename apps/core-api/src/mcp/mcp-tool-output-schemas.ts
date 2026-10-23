import {
  CustomerType,
  InvoiceStatus,
  InvoiceTaxMode,
  LegalEntityCountry,
  LocationType,
  PurchaseOrderStatus,
  VehicleInventoryRole,
  VehicleListingDesiredState,
  VehicleListingExportState,
  VehicleListingPlatform,
  VehicleListingRemoteState,
  VehicleStockStatus,
  WorkshopLineItemType,
  WorkshopOrderPurpose,
  LoanerVehicleStatus,
  WorkshopOrderStatus,
  WorkshopEstimateStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { z } from 'zod';
import { DECISION_APPLY_MODES } from '../decision/decision.constants.js';
import { MCP_CATALOG_ITEM_TYPES } from './mcp-catalog-read.mapper.js';
import { MCP_DOCUMENT_TYPES } from './mcp-document-read.mapper.js';
import {
  MCP_MAX_PAGE_SIZE,
  MCP_TOOL_NAMES,
  type McpToolName,
  type McpWriteToolName,
} from './mcp.constants.js';
import { mergeMcpWriteToolOutput } from './mcp-write-dry-run.schema.js';

/**
 * Output schemas for the MCP tools (AUT-427). The SDK publishes each one as the tool's
 * outputSchema and checks every successful result against it, so a schema must describe the
 * JSON the handler returns. The rules below hold across the registry:
 *
 * - The SDK accepts an object schema only. A top-level union is not published and is not
 *   checked, so every result is one object here: its success keys and the truncation marker
 *   keys are all optional, and superRefine requires the success keys unless the marker is
 *   present. JSON Schema ignores refinements, so published clients see the looser shape.
 * - Amounts, percents and quantities are decimal strings. Date-times are ISO 8601 UTC strings.
 * - A result over MCP_TOOL_RESULT_MAX_BYTES is replaced by the __truncated__ marker. A keyset
 *   list may drop trailing rows instead and set `truncated`.
 * - Rows that a delegated service returns whole (vehicles, workshop orders) describe their
 *   stable fields and allow the rest, so the schema does not restate every column.
 */

// --- Primitives --------------------------------------------------------------

const idString = z.string().min(1);
const nullableIdString = idString.nullable();
const nonEmptyString = z.string().min(1);
const nullableString = z.string().nullable();
const count = z.number().int().min(0);
const pageSize = z.number().int().min(1).max(MCP_MAX_PAGE_SIZE);
const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string');
const nullableDecimalString = decimalString.nullable();
const isoDateTime = z.iso.datetime();
const nullableIsoDateTime = isoDateTime.nullable();
const isoDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const yearMonth = z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM');

// --- Pages -------------------------------------------------------------------

/** Keyset page envelope: the cursor for the next page, or null on the last page. */
const keysetMeta = z.object({
  page_size: pageSize,
  next_cursor: nonEmptyString.nullable(),
});
/** Offset page envelope for the record reads. */
const offsetMeta = z.object({
  total: count,
  page: z.number().int().min(1),
  page_size: pageSize,
});
/** Offset page envelope of the report and capability reads, which pair a total with a cursor. */
const totalCursorMeta = z.object({
  total: count,
  page_size: pageSize,
  next_cursor: nonEmptyString.nullable(),
});
/** Camel-case offset envelope of the workshop, vehicle and parts lists. */
const camelOffsetMeta = z.object({
  total: count,
  page: z.number().int().min(1),
  pageSize,
  pageCount: count,
});

function keysetPageShape<T extends z.ZodType>(row: T) {
  return {
    data: z.array(row),
    meta: keysetMeta,
    truncated: z.boolean(),
  };
}

function cursorPageShape<T extends z.ZodType>(row: T) {
  return { data: z.array(row), meta: keysetMeta };
}

function offsetPageShape<T extends z.ZodType>(row: T) {
  return { data: z.array(row), meta: offsetMeta };
}

// --- Truncation and variants -------------------------------------------------

/** Replaces a result over the cap. The preview is the start of the serialized result. */
const truncatedMarkerShape = {
  __truncated__: z.literal(true),
  originalBytes: count,
  preview: z.string(),
};

type Shape = Record<string, z.ZodType>;

function optionalShape<S extends Shape>(shape: S) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, schema.optional()]),
  ) as { [K in keyof S]: z.ZodOptional<S[K]> };
}

/**
 * One tool result: the success body, or the truncation marker. Every key is optional in the
 * published object, and superRefine requires the success keys unless the marker is present.
 */
function resultOf<S extends Shape>(
  success: S,
  options: { loose?: boolean } = {},
) {
  const requiredKeys = Object.keys(success).filter(
    (key) => !success[key].safeParse(undefined).success,
  );
  const shape = {
    ...optionalShape(success),
    ...optionalShape(truncatedMarkerShape),
  };
  const object = options.loose ? z.looseObject(shape) : z.object(shape);
  return object.superRefine((value, ctx) => {
    const fields = value as Record<string, unknown>;
    if (fields.__truncated__ === true) {
      return;
    }
    for (const key of requiredKeys) {
      if (fields[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required`,
        });
      }
    }
  });
}

// --- Shared rows ---------------------------------------------------------------

const customerFields = {
  id: idString,
  tenant_id: idString,
  type: z.enum(CustomerType),
  company_name: nullableString,
  first_name: z.string(),
  last_name: z.string(),
  email: nullableString,
  phone: nullableString,
  vat_id: nullableString,
  address_street: nullableString,
  address_city: nullableString,
  address_zip: nullableString,
  address_country: nullableString,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
};

/** A customer row from the search, which also carries the e-mail consent flag. */
const customerSearchRow = z.object({
  ...customerFields,
  contact_email_ok: z.boolean(),
});

const locationRow = z.object({
  id: idString,
  tenant_id: idString,
  site_id: idString,
  code: z.string(),
  name: z.string(),
  type: z.enum(LocationType),
  is_system: z.boolean(),
  parent_id: nullableIdString,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: nullableIsoDateTime,
});

const pickerlDueSchema = z.object({
  due_month: yearMonth.nullable(),
  status: z.enum(['OK', 'DUE_SOON', 'OVERDUE', 'UNKNOWN']),
  rule_id: z.enum(['m1-legacy-pre-2027', 'm1-kfg42-from-2027-05-19']),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  last_inspected_on: z.string().nullable(),
});

const vehicleContextInspectionRow = z.object({
  id: idString,
  inspection_type: z.string(),
  inspected_on: isoDateOnly,
  plaketten_valid_until: yearMonth,
  station_name: nullableString,
  value_source: z.object({
    table: z.literal('vehicle_inspection_record'),
    resolved_pickerl_rule_id: z.string(),
  }),
  limits: z.object({
    includes_notes: z.literal(false),
    sticker_validity_is_month_granularity: z.literal(true),
    interval_years: z.array(z.number().int().min(1)),
    tolerance_months_before: z.number().int().min(0),
    tolerance_months_after: z.number().int().min(0),
  }),
});

const vehicleContextGewaehrleistungLimits = z
  .object({
    base_period_years: z.number().int(),
    shortened_period_years: z.number().int(),
    presumption_period_years: z.number().int(),
    minimum_vehicle_age_years: z.number().int(),
    scope_note: z.string(),
  })
  .nullable();

const vehicleContextWarrantyPeriodRow = z.object({
  vehicle_sale_id: idString,
  sale_number: nonEmptyString,
  contract_concluded_on: isoDateOnly.nullable(),
  handed_over_on: isoDateOnly.nullable(),
  gewaehrleistung_status: z.string().nullable(),
  gewaehrleistung_ends_on: isoDateOnly.nullable(),
  presumption_ends_on: isoDateOnly.nullable(),
  gewaehrleistung_ends_on_expired: z.boolean(),
  presumption_ends_on_expired: z.boolean(),
  shortened_negotiated: z.boolean(),
  buyer_is_consumer: z.boolean().nullable(),
  value_source: z.object({
    persisted_rule_version: nullableString,
    resolved_rule_set_id: nullableString,
  }),
  limits: vehicleContextGewaehrleistungLimits,
  document_ref: nonEmptyString,
  created_at: isoDateTime,
});

/** A vehicle as a link inside another record: identity, model, and plate. */
const vehicleLinkRow = z.looseObject({
  id: idString,
  make: z.string(),
  model: z.string(),
  plate: nullableString,
});

const vehicleListRow = z.looseObject({
  id: idString,
  tenant_id: idString,
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  vin: nullableString,
  plate: nullableString,
  inventory_role: z.enum(VehicleInventoryRole),
  stock_status: z.enum(VehicleStockStatus).nullable(),
  customer_id: nullableIdString,
  location_id: nullableIdString,
  site_id: nullableIdString,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const vehicleDetailShape = {
  ...vehicleListRow.shape,
  reserved_for_customer_id: nullableIdString,
  pickerl_due: pickerlDueSchema,
  customer: customerSearchRow.nullable(),
  location: locationRow.nullable(),
  reserved_for_customer: customerSearchRow.nullable(),
  sales: z.array(z.looseObject({ id: idString })),
  invoices: z.array(z.looseObject({ id: idString })),
  purchases: z.array(z.looseObject({ id: idString })),
  sales_orders: z.array(z.looseObject({ id: idString })),
  workshop_orders: z.array(z.looseObject({ id: idString })),
  parties: z.array(z.looseObject({ id: idString })).optional(),
  open_due_dates: z.array(z.looseObject({ id: idString })).optional(),
};

const workshopOrderShape = {
  id: idString,
  tenant_id: idString,
  site_id: nullableIdString,
  order_number: nonEmptyString,
  status: z.enum(WorkshopOrderStatus),
  purpose: z.enum(WorkshopOrderPurpose),
  customer_id: nullableIdString,
  vehicle_id: idString,
  staging_location_id: nullableIdString,
  mechanic_id: nullableIdString,
  bay_id: nullableIdString,
  odometer: count,
  fuel_level: count,
  reported_issue: nullableString,
  notes: nullableString,
  scheduled_start_at: nullableIsoDateTime,
  scheduled_end_at: nullableIsoDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  invoice: z
    .object({ id: idString, invoice_number: nullableString })
    .nullable()
    .optional(),
  vehicle: vehicleLinkRow,
  tasks: z.array(z.looseObject({ id: idString })),
  estimate: z
    .object({
      number: nonEmptyString,
      version: count,
      status: z.enum([
        WorkshopEstimateStatus.DRAFT,
        WorkshopEstimateStatus.SENT,
        WorkshopEstimateStatus.APPROVED,
        WorkshopEstimateStatus.DECLINED,
        WorkshopEstimateStatus.EXPIRED,
      ]),
      sent_at: nullableIsoDateTime,
      valid_until: nullableIsoDateTime,
      total_gross: nullableDecimalString,
    })
    .nullable()
    .optional(),
};

const workshopSlotRow = z.object({
  bay_id: idString,
  start_at: isoDateTime,
  end_at: isoDateTime,
});

const availableLoanerRow = z.object({
  loaner_vehicle_id: idString,
  vehicle_id: idString,
  display_name: nonEmptyString,
  status: z.enum(LoanerVehicleStatus),
});

const availabilityEnvelope = {
  site_id: idString,
  timezone: nonEmptyString,
  from: isoDateTime,
  to: isoDateTime,
  availability_note: nonEmptyString,
  data: z.array(z.unknown()),
  meta: totalCursorMeta,
};

const workshopTaskRow = z.object({
  id: idString,
  line_items: z.array(
    z.object({
      catalog_item_id: nullableIdString,
      description: z.string(),
      id: idString,
      item_no: z.string(),
      quantity: decimalString,
      type: z.enum(WorkshopLineItemType),
      unit_price: decimalString,
    }),
  ),
  line_items_version: count,
  status: z.enum(WorkshopTaskStatus),
  title: z.string(),
  workshop_order_id: idString,
});

/** Order rows of the customer and vehicle history: workshop and sales orders share one shape. */
const orderHistoryRow = z.object({
  id: idString,
  kind: z.enum(['workshop_order', 'sales_order']),
  number: nonEmptyString,
  status: nonEmptyString,
  vehicle: z
    .object({
      id: idString,
      plate: nullableString,
      make: z.string(),
      model: z.string(),
    })
    .nullable(),
  date: isoDateTime,
  total_gross: nullableDecimalString,
});

const documentOwnerTypes = [
  'invoice',
  'credit_note',
  'workshop_order',
  'vehicle_sale',
] as const;

const documentRowShape = {
  id: nonEmptyString,
  type: z.enum(MCP_DOCUMENT_TYPES),
  name: nonEmptyString,
  created_at: isoDateTime,
  entity: z.object({ type: z.enum(documentOwnerTypes), id: idString }),
};

const auditEventRow = z.object({
  id: idString,
  at: isoDateTime,
  entity_type: nonEmptyString,
  entity_id: nonEmptyString,
  action: nonEmptyString,
  actor: nullableString,
  trace_id: nonEmptyString.optional(),
});

const agentActionRow = z.object({
  id: idString,
  trace_id: idString,
  at: isoDateTime,
  agent: nullableString,
  tool: nullableString,
  action_type: nonEmptyString,
  tier: nonEmptyString,
  status: nonEmptyString,
  entity_type: nullableString,
  entity_id: nullableString,
});

const invoiceCustomer = z.object({ id: idString, name: nonEmptyString });

const invoiceListRow = z.object({
  id: idString,
  number: nullableString,
  status: z.enum(InvoiceStatus),
  customer: invoiceCustomer,
  issued_at: isoDateTime,
  total_gross: decimalString,
  currency: nonEmptyString,
});

const orderLink = z
  .object({ id: idString, order_number: nullableString })
  .nullable();

const invoiceDetailShape = {
  id: idString,
  number: nullableString,
  status: z.enum(InvoiceStatus),
  tax_mode: z.enum(InvoiceTaxMode),
  currency: nonEmptyString,
  issued_at: isoDateTime,
  due_date: isoDateTime,
  amount_source: z.enum(['snapshot', 'stored']),
  customer: invoiceCustomer,
  workshop_order: orderLink,
  sales_order: orderLink,
  seller: z
    .looseObject({})
    .nullable()
    .describe(
      'Seller block as the invoice PDF prints it; null for drafts and for legacy snapshots',
    ),
  totals: z.object({
    net: decimalString,
    tax: decimalString,
    gross: decimalString,
  }),
  credit_notes: z.array(
    z.object({
      id: idString,
      number: nullableString,
      status: nonEmptyString,
      total_gross: decimalString,
      issued_at: nullableIsoDateTime,
    }),
  ),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: decimalString,
      unit_net: decimalString,
      tax_rate: decimalString,
      net: nullableDecimalString,
      gross: nullableDecimalString,
    }),
  ),
  lines_total: count,
  lines_truncated: z.boolean(),
};

const purchaseOrderVendor = z.object({ id: idString, name: nonEmptyString });

const purchaseOrderListRow = z.object({
  id: idString,
  number: nonEmptyString,
  status: z.enum(PurchaseOrderStatus),
  vendor: purchaseOrderVendor,
  ordered_at: isoDateTime,
  total_net: decimalString,
});

const catalogListRow = z.object({
  id: idString,
  sku: nonEmptyString,
  name: nonEmptyString,
  type: z.enum(MCP_CATALOG_ITEM_TYPES),
  unit: nonEmptyString,
  price_net: decimalString,
});

const brandLink = z.object({ id: z.number().int(), name: z.string() });

// --- Writes --------------------------------------------------------------------

const wouldChangeItem = z.object({
  entity: nonEmptyString,
  id: idString,
  op: z.enum(['create', 'update', 'delete']),
  provisional: z.boolean(),
});

const writeProposal = z.object({
  payload: z.record(z.string(), z.unknown()),
  would_change: z.array(wouldChangeItem),
  preview: z
    .unknown()
    .describe(
      'The rollback preview of the executor, which depends on the tool',
    ),
  provisional: z.literal(true),
});

const customerProposalDiffItem = z.object({
  field: nonEmptyString,
  before_masked: z.string().nullable(),
  after_masked: z.string().nullable(),
});

const customerDuplicateCandidate = z.object({
  customer_id: idString,
  match_reasons: z.array(nonEmptyString),
  display_name_initials: z.string(),
});

/**
 * A write result. `executed` ran and carries the committed row. `needs_approval` stored a
 * pending proposal and ran nothing. A refused call is a thrown error, not a result.
 */
function writeResultOf(
  tool: McpWriteToolName,
  extra: Shape = {},
): z.ZodTypeAny {
  const shape = {
    ...optionalShape({
      ...extra,
      tool: z.literal(tool),
      tier: z.enum(['AUTO', 'PROPOSE']),
      status: z.enum(['executed', 'needs_approval']),
      would_change: z.array(wouldChangeItem),
      result: z.looseObject({ id: idString }),
      proposal: writeProposal,
      pending_action_id: idString,
      trace_id: idString,
      replayed: z.literal(true).optional(),
    }),
    ...optionalShape(truncatedMarkerShape),
  };
  return z.object(shape).superRefine((value, ctx) => {
    if (value.__truncated__ === true) {
      return;
    }
    const required =
      value.status === 'executed'
        ? ['tool', 'tier', 'would_change', 'result', 'trace_id']
        : value.status === 'needs_approval'
          ? [
              'tool',
              'tier',
              'would_change',
              'proposal',
              'pending_action_id',
              'trace_id',
            ]
          : ['status'];
    for (const key of required) {
      if ((value as Record<string, unknown>)[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required for status ${value.status ?? 'unknown'}`,
        });
      }
    }
    const expectedTier = value.status === 'needs_approval' ? 'PROPOSE' : 'AUTO';
    if (value.status !== undefined && value.tier !== expectedTier) {
      ctx.addIssue({
        code: 'custom',
        path: ['tier'],
        message: `tier must be ${expectedTier} for status ${value.status}`,
      });
    }
  });
}

function publishedWriteToolOutput(
  tool: McpWriteToolName,
  committed: z.ZodTypeAny,
): z.ZodTypeAny {
  return mergeMcpWriteToolOutput(tool, committed);
}

const generateWeeklyReportPdfCommittedOutputSchema = z
  .object({
    ...optionalShape({
      tool: z.literal('generate_weekly_report_pdf'),
      tier: z.enum(['AUTO', 'PROPOSE']),
      status: z.enum(['executed', 'needs_approval']),
      would_change: z.array(wouldChangeItem),
      result: z.object({
        id: idString,
        url: z.string().url(),
        expires_at: z.string().datetime(),
        sha256: z.string().length(64),
        page_count: z.number().int().positive(),
        period: z.object({
          from: z.string(),
          to: z.string(),
          timezone: z.string(),
          iso_week: z.string().nullable(),
        }),
      }),
      proposal: writeProposal,
      pending_action_id: idString,
      trace_id: idString,
      replayed: z.literal(true).optional(),
    }),
    ...optionalShape(truncatedMarkerShape),
  })
  .superRefine((value, ctx) => {
    if (value.__truncated__ === true) {
      return;
    }
    if (value.status === 'executed') {
      for (const key of [
        'tool',
        'tier',
        'would_change',
        'result',
        'trace_id',
      ] as const) {
        if ((value as Record<string, unknown>)[key] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required for executed weekly report PDF`,
          });
        }
      }
      if (value.tier !== 'AUTO') {
        ctx.addIssue({
          code: 'custom',
          path: ['tier'],
          message: 'tier must be AUTO for executed weekly report PDF',
        });
      }
    }
  });

// --- Per-tool output schemas ---------------------------------------------------

const stockBinSummaryFields = {
  bin_id: nullableIdString,
  bin_label: nullableString,
};

const stockBinLevelRow = z.object({
  location_id: idString,
  name: z.string(),
  code: z.string(),
  quantity_on_hand: z.number(),
  quantity_reserved: z.number(),
  quantity_available: z.number(),
});

const searchPartsInventoryRow = z.object({
  id: idString,
  catalog_item_id: idString,
  sku: nonEmptyString,
  name: z.string(),
  brand: z.string(),
  brand_id: z.number().int().nullable(),
  price: z.number(),
  status: z.enum(['IN_STOCK', 'OUT_OF_STOCK', 'SUPERSEDED']),
  quantity_available: z.number().int(),
  warehouse_location: z.string(),
  ...stockBinSummaryFields,
});

const searchPartsCatalogLabor = z.object({
  id: idString,
  code: nonEmptyString,
  description: z.string(),
  standardAw: z.number(),
  hourlyRate: z.number(),
  categoryName: nullableString,
});

const searchPartsCatalogPart = z.object({
  id: idString,
  catalog_item_id: nullableIdString,
  supplierPartNumber: z.string(),
  oemNumber: nullableString,
  description: z.string(),
  brand: z.string(),
  quantityOnHand: z.number(),
  binLocation: nullableString,
  costPrice: z.number().nullable(),
  retailPrice: z.number().nullable(),
  ...stockBinSummaryFields,
});

const catalogSearchMeta = z.object({
  laborCount: count,
  partCount: count,
  limit: count,
});

/**
 * search_parts returns the inventory list, or the workshop catalog when given an order ID.
 * The two bodies have different keys, so superRefine accepts either one.
 */
const searchPartsResult = z
  .object({
    ...optionalShape({
      data: z.array(searchPartsInventoryRow),
      meta: z.union([camelOffsetMeta, catalogSearchMeta]),
      labor: z.array(searchPartsCatalogLabor),
      parts: z.array(searchPartsCatalogPart),
    }),
    ...optionalShape(truncatedMarkerShape),
  })
  .superRefine((value, ctx) => {
    if (value.__truncated__ === true) {
      return;
    }
    const inventory =
      value.data !== undefined &&
      value.meta !== undefined &&
      value.labor === undefined;
    const catalog = value.labor !== undefined && value.parts !== undefined;
    if (!inventory && !catalog) {
      ctx.addIssue({
        code: 'custom',
        message:
          'search_parts returns data and meta, or labor and parts with an order',
      });
    }
  });

const stockAgeRow = z.object({
  id: idString,
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  vin: nullableString,
  plate: nullableString,
  inventory_role: z.enum(VehicleInventoryRole),
  stock_status: z.enum(VehicleStockStatus).nullable(),
  days_in_stock: count.nullable(),
  missing_stock_in_date: z.boolean(),
  stock_in_date: nullableString,
  age_bucket: nullableString,
  cost_basis: decimalString,
  asking_price: decimalString,
  location: nullableString,
});

const marginReportRow = z.object({
  id: idString,
  sale_number: nonEmptyString,
  vehicle_id: idString,
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  invoice_date: nonEmptyString,
  sale_price: decimalString,
  cost_basis_snapshot: nullableDecimalString,
  gross_margin_eur: nullableDecimalString,
  gross_margin_percent: nullableDecimalString,
  days_to_sell: count.nullable(),
  margin_taxed: z.boolean(),
});

const reportPeriod = z
  .object({ from: isoDateOnly, to: isoDateOnly })
  .nullable();

const legalEntitySeller = z.object({
  name: nonEmptyString,
  country_iso: z.enum(LegalEntityCountry),
  address_street: nullableString,
  address_line2: nullableString,
  address_zip: nullableString,
  address_city: nullableString,
  vat_id: nullableString,
  tax_number: nullableString,
  registration_number: nullableString,
  registration_court: nullableString,
  email: nullableString,
  phone: nullableString,
});

const taxRateRow = z.object({
  name: nonEmptyString,
  tax_rate: decimalString,
  account_number: nonEmptyString,
  is_default: z.boolean(),
});

const numberRangeRow = z.object({
  document: nonEmptyString,
  year: z.number().int().nullable(),
  prefix: nullableString,
  next_number: z.number().int().nullable(),
});

const brandingSummary = z.object({
  legal_entity_id: idString,
  legal_entity_name: nonEmptyString,
  is_confirmed: z.boolean(),
  confirmed_at: nullableIsoDateTime,
  active_revision: count,
  has_logo: z.boolean(),
  has_draft: z.boolean(),
  theme: z.object({
    primary_color: z.string(),
    secondary_color: z.string(),
    font_id: nonEmptyString,
    header_band: nonEmptyString,
    footer_band: nonEmptyString,
    header_text_set: z.boolean(),
    footer_text_set: z.boolean(),
  }),
});

const catalogPriceHistoryRow = z.object({
  at: isoDateTime,
  old_cost: nullableDecimalString,
  new_cost: nullableDecimalString,
  old_retail: nullableDecimalString,
  new_retail: nullableDecimalString,
  import_job_id: nullableString,
});

const marginRuleRow = z.object({
  id: idString,
  scope: z.object({
    brand: brandLink.nullable(),
    revenue_group: brandLink.nullable(),
    cost_min: nullableDecimalString,
    cost_max: nullableDecimalString,
  }),
  markup: z.object({
    percent: nullableDecimalString,
    use_supplier_rrp: z.boolean(),
  }),
  rounding: nonEmptyString,
});

const priceListRow = z.object({
  id: idString,
  name: nonEmptyString,
  vendor: purchaseOrderVendor.nullable(),
  valid_from: nullableIsoDateTime,
  items_count: count,
});

const pickerlDueRow = z.object({
  vehicle: z.object({
    id: idString,
    make: z.string(),
    model: z.string(),
    plate: nullableString,
  }),
  customer_name: nullableString,
  status: z.enum(['OK', 'DUE_SOON', 'OVERDUE', 'UNKNOWN']),
  due_date: isoDateOnly.nullable(),
});

const capabilityRow = z.object({
  tool: z.enum(MCP_TOOL_NAMES),
  description: z.string(),
  tier: z.enum(['AUTO', 'PROPOSE']),
  access: z.enum(['read', 'write']),
  enabled: z.boolean(),
  disabled_reason: z.enum(['policy_disabled', 'role_not_permitted']).optional(),
});

const entityHistoryRow = z.object({
  id: idString,
  at: isoDateTime,
  actor: nullableString,
  action: nonEmptyString,
  trace_id: nonEmptyString.optional(),
  changes: z.array(
    z.object({
      field: nonEmptyString,
      from: z.unknown(),
      to: z.unknown(),
      masked: z.literal(true).optional(),
    }),
  ),
  changes_total: count,
  changes_truncated: z.literal(true).optional(),
});

const agentActionDetailRow = agentActionRow.extend({
  on_behalf_of_user_id: nullableString,
  input: z.unknown(),
  result: z.unknown(),
});

const bayRow = z.object({
  id: idString,
  name: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});

const binRow = z.object({
  id: idString,
  name: z.string(),
  code: z.string(),
  type: z.enum(LocationType),
  parent: locationRow.nullable(),
});

const purchaseOrderLine = z.object({
  id: idString,
  part: z.object({ id: idString, sku: z.string(), name: z.string() }),
  quantity_ordered: decimalString,
  quantity_received: decimalString,
  unit_cost_net: decimalString,
  line_net: decimalString,
});

const stockSummaryTotals = z.object({
  over_90_count: count,
  over_90_cost_basis: decimalString,
  bucket_counts: z.record(z.string(), count),
});

export const mcpToolOutputSchemas = {
  search_customers: resultOf(offsetPageShape(customerSearchRow)),
  get_customer: resultOf({
    ...customerFields,
    vehicles: z.array(vehicleLinkRow),
    orders: z.object(keysetPageShape(orderHistoryRow)),
  }),
  get_vehicle: resultOf(vehicleDetailShape, { loose: true }),
  search_vehicles: resultOf({
    data: z.array(vehicleListRow),
    meta: camelOffsetMeta,
  }),
  list_workshop_orders: resultOf({
    data: z.array(z.looseObject(workshopOrderShape)),
    meta: camelOffsetMeta,
  }),
  get_workshop_order: resultOf(workshopOrderShape, { loose: true }),
  search_parts: searchPartsResult,
  get_stock_level: resultOf({
    catalog_item_id: idString.optional(),
    sku: nonEmptyString,
    name: z.string(),
    brand: z.string(),
    original_sku: z.string().optional(),
    suggested_sku: z.string().optional(),
    quantity_on_hand: z.number(),
    quantity_reserved: z.number(),
    quantity_available: z.number(),
    is_superseded: z.boolean(),
    bins: z.array(stockBinLevelRow),
    ...stockBinSummaryFields,
  }),
  get_vehicle_stock_age_report: resultOf({
    site_id: idString,
    period: reportPeriod,
    data: z.array(stockAgeRow),
    totals: stockSummaryTotals,
    meta: totalCursorMeta,
  }),
  get_vehicle_stock_margin_report: resultOf({
    site_id: idString,
    period: reportPeriod,
    data: z.array(marginReportRow),
    totals: z.object({
      count,
      gross_margin_known_count: count,
      gross_margin_unknown_count: count,
      gross_margin_total: decimalString,
      gross_margin_average: nullableDecimalString,
      gross_margin_percent_average: nullableDecimalString,
      sale_price_total: decimalString,
      sale_price_average: nullableDecimalString,
      cost_basis_total: decimalString,
      cost_basis_average: nullableDecimalString,
      days_to_sell_average: nullableDecimalString,
    }),
    meta: totalCursorMeta,
  }),
  list_invoices: resultOf(keysetPageShape(invoiceListRow)),
  get_invoice: resultOf(invoiceDetailShape),
  list_bays: resultOf(offsetPageShape(bayRow)),
  list_bins: resultOf(offsetPageShape(binRow)),
  list_workshop_tasks: resultOf(offsetPageShape(workshopTaskRow)),
  list_workshop_slots: resultOf({
    ...availabilityEnvelope,
    duration_minutes: z.number().int().min(1),
    slot_minutes: z.number().int().min(1),
    data: z.array(workshopSlotRow),
  }),
  list_available_loaners: resultOf({
    ...availabilityEnvelope,
    as_of: isoDateTime,
    data: z.array(availableLoanerRow),
  }),
  whoami: resultOf({
    caller: z.object({
      id: nonEmptyString,
      name: nullableString,
      type: z.enum(['agent', 'human_on_behalf']),
    }),
    role: nullableString,
    tenant: z.object({ id: idString, name: z.string() }),
    site: z.object({ id: idString, name: z.string() }).nullable(),
    mode: z.enum(DECISION_APPLY_MODES),
    user_locale: z.enum(['de', 'en']),
    response_language_instruction: z.string(),
  }),
  get_capabilities: resultOf({
    data: z.array(capabilityRow),
    meta: totalCursorMeta,
    human_only_actions: z.array(z.string()),
  }),
  list_audit_events: resultOf(keysetPageShape(auditEventRow)),
  get_entity_history: resultOf(keysetPageShape(entityHistoryRow)),
  get_agent_action: resultOf({
    ...keysetPageShape(agentActionDetailRow),
    trace_id: idString,
    audit_entries: z.array(auditEventRow),
    audit_truncated: z.boolean(),
  }),
  list_agent_actions: resultOf(keysetPageShape(agentActionRow)),
  get_vehicle_history: resultOf({
    vehicle: z.object({
      id: idString,
      make: z.string(),
      model: z.string(),
      year: z.number().int(),
      plate: nullableString,
    }),
    pickerl_due: pickerlDueSchema,
    orders: z.object(keysetPageShape(orderHistoryRow)),
    inspections: z.object({
      data: z.array(
        z.object({
          id: idString,
          inspection_type: z.string(),
          inspected_on: isoDateOnly,
          plaketten_valid_until: yearMonth,
          station_name: nullableString,
        }),
      ),
      meta: z.object({ total: count }),
    }),
    documents: z.object(keysetPageShape(z.object(documentRowShape))),
  }),
  get_vehicle_context: resultOf({
    vehicle_id: idString,
    as_of: isoDateTime,
    disclaimer: nonEmptyString,
    site_id: nullableIdString,
    sections: z.object({
      identity: z
        .object({
          state: z.literal('ok'),
          data: z.object({
            vehicle: z.object({
              id: idString,
              make: z.string(),
              model: z.string(),
              year: z.number().int(),
              plate: nullableString,
              vin: nullableString,
              first_registration_date: isoDateOnly.nullable(),
            }),
            pickerl_due: pickerlDueSchema,
          }),
        })
        .optional(),
      parties: z
        .object({
          state: z.literal('ok'),
          data: z.object({
            parties: z.array(
              z.object({
                id: idString,
                role: z.string(),
                customer_id: idString,
                customer_name: z.string(),
                valid_from: isoDateOnly.nullable(),
                valid_to: isoDateOnly.nullable(),
                source: z.string(),
              }),
            ),
          }),
        })
        .optional(),
      due_dates: z
        .object({
          state: z.literal('ok'),
          data: z.object({
            pickerl_due: pickerlDueSchema,
            open_service_due_total: count,
            open_service_due: z.array(
              z.object({
                id: idString,
                title: z.string(),
                due_date: isoDateOnly.nullable(),
                due_mileage: count.nullable(),
                external_ref: nullableString,
                source: z.string(),
              }),
            ),
          }),
        })
        .optional(),
      open_workshop: z
        .union([
          z.object({
            state: z.literal('ok'),
            data: z.array(
              z.object({
                id: idString,
                number: nonEmptyString,
                status: z.string(),
                opened_at: isoDateTime,
                workshop_order_ref: idString,
              }),
            ),
            meta: totalCursorMeta,
            truncated: z.boolean().optional(),
            incomplete: z.boolean().optional(),
          }),
          z.object({
            state: z.literal('unavailable'),
            reason: z.literal('active_site_required'),
            message: nonEmptyString,
          }),
        ])
        .optional(),
      inspections: z
        .object({
          state: z.literal('ok'),
          data: z.array(vehicleContextInspectionRow),
          meta: totalCursorMeta,
          truncated: z.boolean().optional(),
          incomplete: z.boolean().optional(),
        })
        .optional(),
      documents: z
        .union([
          z.object({
            state: z.literal('ok'),
            data: z.array(z.object(documentRowShape)),
            meta: totalCursorMeta,
            truncated: z.boolean().optional(),
            incomplete: z.boolean().optional(),
          }),
          z.object({
            state: z.literal('unavailable'),
            reason: z.literal('active_site_required'),
            message: nonEmptyString,
          }),
        ])
        .optional(),
      warranty_claims: z
        .union([
          z.object({
            state: z.literal('ok'),
            data: z.array(
              z.object({
                id: idString,
                workshop_order_id: idString,
                type: z.string(),
                status: z.string(),
                claimed_amount_net: nullableDecimalString,
                external_reference: nullableString,
                created_at: isoDateTime,
                workshop_order_ref: idString,
              }),
            ),
            meta: totalCursorMeta,
            truncated: z.boolean().optional(),
            incomplete: z.boolean().optional(),
          }),
          z.object({
            state: z.literal('unavailable'),
            reason: z.literal('active_site_required'),
            message: nonEmptyString,
          }),
        ])
        .optional(),
      warranty_periods: z
        .union([
          z.object({
            state: z.literal('ok'),
            data: z.array(vehicleContextWarrantyPeriodRow),
            meta: totalCursorMeta,
            truncated: z.boolean().optional(),
            incomplete: z.boolean().optional(),
          }),
          z.object({
            state: z.literal('unavailable'),
            reason: z.literal('active_site_required'),
            message: nonEmptyString,
          }),
        ])
        .optional(),
    }),
  }),
  list_documents: resultOf(keysetPageShape(z.object(documentRowShape))),
  get_document_pdf: resultOf({
    ...documentRowShape,
    content_type: z.literal('application/pdf'),
    link: z.object({
      url: nonEmptyString,
      expires_at: isoDateTime,
    }),
  }),
  get_tenant_settings: resultOf({
    currency: z.literal('EUR'),
    active_site_timezone: nullableString,
    feature_flags: z.object({
      decision_apply_mode: z.enum(DECISION_APPLY_MODES),
      voice_translation: z.object({
        target_language_code: nonEmptyString,
        configured: z.boolean(),
      }),
      catalog: z.object({
        identity_adapter_id: nullableString,
        parts_aftermarket_adapter_id: nullableString,
        labor_aftermarket_adapter_id: nullableString,
        aw_minutes: count,
        credentials_configured: z.object({
          identity: z.boolean(),
          parts_aftermarket: z.boolean(),
          labor_aftermarket: z.boolean(),
        }),
      }),
      tyre_storage: z.object({
        summer_swap_date: nonEmptyString,
        winter_swap_date: nonEmptyString,
        due_for_swap_days: count,
      }),
    }),
    document_branding: z.array(brandingSummary),
  }),
  list_sites: resultOf(
    cursorPageShape(
      z.object({
        id: idString,
        name: nonEmptyString,
        address_summary: nullableString,
        active: z.boolean(),
      }),
    ),
  ),
  get_legal_entity: resultOf({
    id: idString,
    is_active: z.boolean(),
    seller: legalEntitySeller,
    bank: z.object({
      iban: nullableString,
      bic: nullableString,
      bank_name: nullableString,
    }),
    payment_terms: z.object({
      days: count.nullable(),
      text: nullableString,
    }),
    seller_readiness: z.object({
      is_ready: z.boolean(),
      missing_fields: z.array(z.string()),
    }),
    accounting_profile: z.object({
      configured: z.boolean(),
      is_enabled: z.boolean(),
      is_ready: z.boolean(),
      missing_fields: z.array(z.string()),
      unmapped_categories: z.array(z.string()),
    }),
    tax_rates: z.array(taxRateRow),
    number_ranges: z.array(numberRangeRow),
  }),
  list_purchase_orders: resultOf(keysetPageShape(purchaseOrderListRow)),
  get_purchase_order: resultOf({
    id: idString,
    number: nonEmptyString,
    status: z.enum(PurchaseOrderStatus),
    currency: z.literal('EUR'),
    ordered_at: isoDateTime,
    vendor: purchaseOrderVendor,
    totals: z.object({ net: decimalString }),
    receipts: z.object({
      movement_count: count,
      last_received_at: nullableIsoDateTime,
    }),
    lines: z.array(purchaseOrderLine),
    lines_total: count,
    lines_truncated: z.boolean(),
  }),
  list_vendors: resultOf(
    keysetPageShape(
      z.object({ id: idString, name: nonEmptyString, active: z.boolean() }),
    ),
  ),
  list_catalog_items: resultOf(cursorPageShape(catalogListRow)),
  get_catalog_item: resultOf({
    id: idString,
    sku: nonEmptyString,
    name: nonEmptyString,
    type: z.literal('part'),
    unit: nonEmptyString,
    ean: nullableString,
    active: z.boolean(),
    superseded_by: z
      .object({ id: idString, sku: nonEmptyString, name: nonEmptyString })
      .nullable(),
    brand: brandLink.nullable(),
    tax_class: z
      .object({
        revenue_group_id: z.number().int(),
        name: nonEmptyString,
        tax_rate: decimalString,
      })
      .nullable(),
    price_net: decimalString,
    cost_price: nullableDecimalString,
    oem_numbers: z.array(z.string()),
    default_bin: z
      .object({
        location_id: idString,
        code: z.string(),
        name: z.string(),
        quantity_on_hand: z.number(),
      })
      .nullable(),
    default_vendor: z
      .object({
        vendor_id: idString,
        name: nonEmptyString,
        vendor_article_no: z.string(),
        last_cost: nullableDecimalString,
        last_rrp: nullableDecimalString,
      })
      .nullable(),
    price_history: z.array(catalogPriceHistoryRow),
  }),
  list_price_lists: resultOf(cursorPageShape(priceListRow)),
  list_margin_rules: resultOf(cursorPageShape(marginRuleRow)),
  get_revenue_report: resultOf({
    period: z.object({
      from: isoDateOnly,
      to: isoDateOnly,
      timezone: nonEmptyString,
    }),
    site_id: idString,
    totals: z.object({
      net: decimalString,
      vat: decimalString,
      gross: decimalString,
    }),
    by_source: z.array(
      z.object({
        source: z.enum(['workshop', 'vehicle_sales', 'other']),
        net: decimalString,
        vat: decimalString,
        gross: decimalString,
      }),
    ),
    by_revenue_group: z.array(
      z.object({
        name: nonEmptyString,
        net: decimalString,
        vat: decimalString,
        gross: decimalString,
      }),
    ),
    invoice_count: count,
    previous: z
      .object({
        period: z.object({
          from: isoDateOnly,
          to: isoDateOnly,
          timezone: nonEmptyString,
        }),
        site_id: idString,
        totals: z.object({
          net: decimalString,
          vat: decimalString,
          gross: decimalString,
        }),
        by_source: z.array(
          z.object({
            source: z.enum(['workshop', 'vehicle_sales', 'other']),
            net: decimalString,
            vat: decimalString,
            gross: decimalString,
          }),
        ),
        by_revenue_group: z.array(
          z.object({
            name: nonEmptyString,
            net: decimalString,
            vat: decimalString,
            gross: decimalString,
          }),
        ),
        invoice_count: count,
      })
      .optional(),
  }),
  get_workshop_kpi_report: resultOf({
    site_id: idString,
    period: z.object({
      from: isoDateOnly,
      to: isoDateOnly,
      timezone: nonEmptyString,
    }),
    utilisation_percent: nullableDecimalString,
    productivity_percent: nullableDecimalString,
    revenue_per_order: nullableDecimalString,
    closed_orders: count,
    labor_net_revenue: decimalString,
    parts_net_revenue: decimalString,
    available_hours: decimalString,
    clocked_hours: decimalString,
    sold_hours: decimalString,
    open_labor_entry_count: count,
    unassigned_mechanic_count: count,
    parts_turnover: z.object({
      issued_cost: decimalString,
      average_stock_value: nullableDecimalString,
      turnover: nullableDecimalString,
      unvalued_stock_item_count: count,
    }),
  }),
  list_pickerl_due: resultOf({
    window_days: z.union([z.literal(30), z.literal(60), z.literal(90)]),
    data: z.array(pickerlDueRow),
    meta: totalCursorMeta,
  }),
  get_nova_preview: resultOf({
    vehicle_id: idString,
    net_price_eur: decimalString,
    nova_eur: decimalString,
    rate_percent: z.number(),
    effective_co2_g_km: z.number(),
    tariff_version_id: nonEmptyString,
    applied_rule_ids: z.array(z.string()),
    warnings: z.array(z.string()),
    has_unverified_rules: z.boolean(),
    note: nonEmptyString,
  }),
  get_vehicle_listing_status: resultOf({
    vehicle_id: idString,
    listings: z.array(
      z.object({
        listing_id: idString,
        listing_ref: nonEmptyString,
        stock_purchase_id: idString,
        site_id: idString,
        revision: count,
        channels: z.array(
          z.object({
            platform: z.enum(VehicleListingPlatform),
            desired_state: z.enum(VehicleListingDesiredState),
            export_state: z.enum(VehicleListingExportState),
            remote_state: z.enum(VehicleListingRemoteState),
            serializer_profile: nonEmptyString,
            last_export_at: nullableIsoDateTime,
            removal_revision: count,
          }),
        ),
      }),
    ),
  }),
  draft_workshop_order: publishedWriteToolOutput(
    'draft_workshop_order',
    writeResultOf('draft_workshop_order'),
  ),
  reserve_part: publishedWriteToolOutput(
    'reserve_part',
    writeResultOf('reserve_part'),
  ),
  release_reservation: publishedWriteToolOutput(
    'release_reservation',
    writeResultOf('release_reservation'),
  ),
  propose_line_item: publishedWriteToolOutput(
    'propose_line_item',
    writeResultOf('propose_line_item'),
  ),
  propose_registration_intake: publishedWriteToolOutput(
    'propose_registration_intake',
    writeResultOf('propose_registration_intake'),
  ),
  propose_workshop_booking: publishedWriteToolOutput(
    'propose_workshop_booking',
    writeResultOf('propose_workshop_booking'),
  ),
  propose_purchase_order: publishedWriteToolOutput(
    'propose_purchase_order',
    writeResultOf('propose_purchase_order'),
  ),
  propose_workshop_order_completion: publishedWriteToolOutput(
    'propose_workshop_order_completion',
    writeResultOf('propose_workshop_order_completion'),
  ),
  propose_invoice_draft_from_order: publishedWriteToolOutput(
    'propose_invoice_draft_from_order',
    writeResultOf('propose_invoice_draft_from_order'),
  ),
  propose_estimate_send: publishedWriteToolOutput(
    'propose_estimate_send',
    writeResultOf('propose_estimate_send'),
  ),
  request_workshop_media_upload: publishedWriteToolOutput(
    'request_workshop_media_upload',
    writeResultOf('request_workshop_media_upload'),
  ),
  propose_mechanic_finding: publishedWriteToolOutput(
    'propose_mechanic_finding',
    writeResultOf('propose_mechanic_finding'),
  ),
  propose_customer_create: publishedWriteToolOutput(
    'propose_customer_create',
    writeResultOf('propose_customer_create', {
      diff: z.array(customerProposalDiffItem),
      duplicate_candidates: z.array(customerDuplicateCandidate),
    }),
  ),
  propose_customer_update: publishedWriteToolOutput(
    'propose_customer_update',
    writeResultOf('propose_customer_update', {
      diff: z.array(customerProposalDiffItem),
      duplicate_candidates: z.array(customerDuplicateCandidate),
    }),
  ),
  generate_weekly_report_pdf: publishedWriteToolOutput(
    'generate_weekly_report_pdf',
    generateWeeklyReportPdfCommittedOutputSchema,
  ),
} satisfies Record<McpToolName, z.ZodType>;
