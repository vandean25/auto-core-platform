import type { Prisma } from '@prisma/client';
import { z } from 'zod';

/**
 * Catalog and price reads (AUT-460). Parts are CatalogItem rows. Labor is not
 * stored in catalog_items, so list_catalog_items with type `labor` lists the
 * tenant's LaborOperation rows in the same row shape. Amounts and percents are
 * decimal strings with two places, such as "12.50", never numbers.
 */

export const MCP_CATALOG_ITEM_TYPES = ['part', 'labor'] as const;
export type McpCatalogItemType = (typeof MCP_CATALOG_ITEM_TYPES)[number];

/** A labor operation is priced per hour. */
const LABOR_UNIT = 'h';
/** Supplier article numbers in a catalog item detail. */
const MAX_OEM_NUMBERS = 20;
/** Price history rows in a catalog item detail. */
export const MCP_PRICE_HISTORY_LIMIT = 5;

type Decimal = Prisma.Decimal;
type Json = Prisma.JsonValue;

/** Keyset position of a catalog list: the sort key (SKU or labor code), then the row ID. */
export const mcpCatalogItemPositionSchema = z.object({
  type: z.enum(MCP_CATALOG_ITEM_TYPES),
  key: z.string(),
  id: z.string().uuid(),
});
export type McpCatalogItemPosition = z.infer<
  typeof mcpCatalogItemPositionSchema
>;

/**
 * Keyset position of a margin rule list: the priority, then the row ID. The
 * priority column is a 32-bit integer, so the cursor is bounded to that range.
 */
export const mcpMarginRulePositionSchema = z.object({
  priority: z.number().int().min(-2147483648).max(2147483647),
  id: z.string().uuid(),
});
export type McpMarginRulePosition = z.infer<typeof mcpMarginRulePositionSchema>;

/**
 * Keyset position of a price list: the applied time, then the row ID. Its own
 * shape keeps a cursor from another list, such as list_invoices, from paging here.
 */
export const mcpPriceListPositionSchema = z.object({
  applied_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'applied_at must be an ISO-8601 date-time',
  }),
  id: z.string().uuid(),
});
export type McpPriceListPosition = z.infer<typeof mcpPriceListPositionSchema>;

export type McpListPage<TRow> = {
  data: TRow[];
  meta: { page_size: number; next_cursor: string | null };
};

/** Two decimal places, the form of every EUR amount and percent here. */
export function toDecimalString(value: Decimal): string {
  return value.toFixed(2);
}

export function toDecimalStringOrNull(value: Decimal | null): string | null {
  return value === null ? null : toDecimalString(value);
}

/** One page of a keyset list: the first pageSize rows, and a cursor from the last of them when more follow. */
export function toMcpListPage<TRecord, TRow>(
  records: readonly TRecord[],
  pageSize: number,
  options: {
    cursorOf: (record: TRecord) => string;
    mapRow: (record: TRecord) => TRow;
  },
): McpListPage<TRow> {
  const kept = records.slice(0, pageSize);
  const last = kept.at(-1);
  const hasMore = records.length > pageSize;
  return {
    data: kept.map((record) => options.mapRow(record)),
    meta: {
      page_size: pageSize,
      next_cursor:
        hasMore && last !== undefined ? options.cursorOf(last) : null,
    },
  };
}

/** The compact row of list_catalog_items. */
export type McpCatalogListRow = {
  id: string;
  sku: string;
  name: string;
  type: McpCatalogItemType;
  unit: string;
  price_net: string;
};

export function toMcpPartListRow(record: {
  id: string;
  sku: string;
  name: string;
  unit: string;
  retail_price: Decimal;
}): McpCatalogListRow {
  return {
    id: record.id,
    sku: record.sku,
    name: record.name,
    type: 'part',
    unit: record.unit,
    price_net: toDecimalString(record.retail_price),
  };
}

export function toMcpLaborListRow(record: {
  id: string;
  code: string;
  description: string;
  hourly_rate: Decimal;
}): McpCatalogListRow {
  return {
    id: record.id,
    sku: record.code,
    name: record.description,
    type: 'labor',
    unit: LABOR_UNIT,
    price_net: toDecimalString(record.hourly_rate),
  };
}

export type McpPriceHistoryRecord = {
  createdAt: Date;
  old_cost: Decimal | null;
  new_cost: Decimal | null;
  old_retail: Decimal | null;
  new_retail: Decimal | null;
  import_job_id: string | null;
};

export function toMcpPriceHistoryRow(record: McpPriceHistoryRecord) {
  return {
    at: record.createdAt.toISOString(),
    old_cost: toDecimalStringOrNull(record.old_cost),
    new_cost: toDecimalStringOrNull(record.new_cost),
    old_retail: toDecimalStringOrNull(record.old_retail),
    new_retail: toDecimalStringOrNull(record.new_retail),
    import_job_id: record.import_job_id,
  };
}

export type McpCatalogItemDetailRecord = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  ean: string | null;
  cost_price: Decimal | null;
  retail_price: Decimal;
  oem_numbers: Json | null;
  superseded_by_id: string | null;
};

/** Rows the detail reads beside the item itself, each already scoped to the tenant. */
export type McpCatalogItemRelated = {
  brand: { id: number; name: string } | null;
  revenueGroup: { id: number; name: string; tax_rate: Decimal } | null;
  supersededBy: { id: string; sku: string; name: string } | null;
  defaultBin: {
    quantity_on_hand: Decimal;
    location: { id: string; code: string; name: string };
  } | null;
  defaultVendor: {
    vendor: { id: string; name: string };
    vendor_article_no: string;
    last_cost: Decimal | null;
    last_rrp: Decimal | null;
  } | null;
  priceHistory: McpPriceHistoryRecord[];
};

/** The string entries of a JSON array, capped. Any other JSON value gives an empty list. */
function stringList(value: Json | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .slice(0, MAX_OEM_NUMBERS);
}

export function toMcpCatalogItemDetail(
  item: McpCatalogItemDetailRecord,
  related: McpCatalogItemRelated,
) {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    type: 'part' as const,
    unit: item.unit,
    ean: item.ean,
    active: item.superseded_by_id === null,
    superseded_by: related.supersededBy,
    brand: related.brand,
    tax_class: related.revenueGroup
      ? {
          revenue_group_id: related.revenueGroup.id,
          name: related.revenueGroup.name,
          tax_rate: toDecimalString(related.revenueGroup.tax_rate),
        }
      : null,
    price_net: toDecimalString(item.retail_price),
    cost_price: toDecimalStringOrNull(item.cost_price),
    oem_numbers: stringList(item.oem_numbers),
    default_bin: related.defaultBin
      ? {
          location_id: related.defaultBin.location.id,
          code: related.defaultBin.location.code,
          name: related.defaultBin.location.name,
          quantity_on_hand: Number(related.defaultBin.quantity_on_hand),
        }
      : null,
    default_vendor: related.defaultVendor
      ? {
          vendor_id: related.defaultVendor.vendor.id,
          name: related.defaultVendor.vendor.name,
          vendor_article_no: related.defaultVendor.vendor_article_no,
          last_cost: toDecimalStringOrNull(related.defaultVendor.last_cost),
          last_rrp: toDecimalStringOrNull(related.defaultVendor.last_rrp),
        }
      : null,
    price_history: related.priceHistory.map(toMcpPriceHistoryRow),
  };
}

export type McpPriceListRecord = {
  id: string;
  file_name: string;
  appliedAt: Date | null;
  totals_json: Json;
  options_json: Json;
};

function jsonObject(value: Json): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : null;
}

/** The vendor a supplier price list was imported for, from the import options. */
export function vendorIdOfPriceList(options: Json): string | null {
  const vendorId = jsonObject(options)?.vendor_id;
  return typeof vendorId === 'string' && vendorId.length > 0 ? vendorId : null;
}

/** Rows in the imported file, from the job totals written when the file was read. */
function itemsCountOfPriceList(totals: Json): number {
  const rows = jsonObject(totals)?.rows;
  return typeof rows === 'number' && Number.isInteger(rows) && rows >= 0
    ? rows
    : 0;
}

/**
 * A supplier price list is an applied SUPPLIER_PRICE_LIST import job. The
 * import has no validity date, so `valid_from` is the moment it was applied.
 */
export function toMcpPriceListRow(
  record: McpPriceListRecord,
  vendor: { id: string; name: string } | null,
) {
  return {
    id: record.id,
    name: record.file_name,
    vendor,
    valid_from: record.appliedAt?.toISOString() ?? null,
    items_count: itemsCountOfPriceList(record.totals_json),
  };
}

export type McpMarginRuleRecord = {
  id: string;
  cost_min: Decimal | null;
  cost_max: Decimal | null;
  markup_percent: Decimal | null;
  use_supplier_rrp: boolean;
  rounding: string;
};

/**
 * A margin rule's scope and markup, the four fields of the list_margin_rules
 * contract. The brand and revenue group are resolved by the caller.
 */
export function toMcpMarginRuleRow(
  record: McpMarginRuleRecord,
  related: {
    brand: { id: number; name: string } | null;
    revenueGroup: { id: number; name: string } | null;
  },
) {
  return {
    id: record.id,
    scope: {
      brand: related.brand,
      revenue_group: related.revenueGroup,
      cost_min: toDecimalStringOrNull(record.cost_min),
      cost_max: toDecimalStringOrNull(record.cost_max),
    },
    markup: {
      percent: toDecimalStringOrNull(record.markup_percent),
      use_supplier_rrp: record.use_supplier_rrp,
    },
    rounding: record.rounding,
  };
}
