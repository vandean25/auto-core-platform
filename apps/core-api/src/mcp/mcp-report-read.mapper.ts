import type { PickerlDueStatus } from '../vehicle/pickerl/compute-pickerl-due.js';
import {
  endOfMonthUtc,
  parseYearMonthString,
} from '../vehicle/pickerl/pickerl-date.util.js';
import type { NovaCalculateResult } from '../vehicle/nova-calculation.service.js';
import type { VehicleStockReportsService } from '../vehicle-stock/vehicle-stock-reports.service.js';
import type { RevenueReportResult } from '../finance/finance-revenue-report.types.js';
import type { WorkshopKpiReportsService } from '../workshop/workshop-kpi-reports.service.js';
import {
  mcpCustomerName,
  type McpInvoiceCustomer,
} from './mcp-invoice-read.mapper.js';
import { decodeMcpCursor, encodeMcpCursor } from './mcp-output.util.js';

/**
 * Shapes for the AUT-461 report reads. The services only reuse domain reports, so this
 * file maps their results to compact MCP payloads: EUR amounts stay decimal strings,
 * and paging is the offset cursor of the static-list reads.
 */

export type McpReportScope = {
  siteId: string;
  from?: string;
  to?: string;
  offset: number;
  pageSize: number;
};

type StockAgeReport = Awaited<
  ReturnType<VehicleStockReportsService['stockAge']>
>;
type StockMarginReport = Awaited<
  ReturnType<VehicleStockReportsService['margin']>
>;
type WorkshopKpiReport = Awaited<
  ReturnType<WorkshopKpiReportsService['getReport']>
>;

/** An offset cursor from encodeMcpCursor, or 0 for the first page. */
export function offsetFromCursor(cursor: string | undefined): number {
  return cursor === undefined ? 0 : (decodeMcpCursor(cursor) ?? 0);
}

/** Envelope metadata for an offset page: the total and the cursor for the next page, or null. */
export function toMcpPageMeta(
  total: number,
  scope: Pick<McpReportScope, 'offset' | 'pageSize'>,
) {
  const nextOffset = scope.offset + scope.pageSize;
  return {
    total,
    page_size: scope.pageSize,
    next_cursor: nextOffset < total ? encodeMcpCursor(nextOffset) : null,
  };
}

function toMcpPeriod(scope: Pick<McpReportScope, 'from' | 'to'>) {
  return scope.from !== undefined && scope.to !== undefined
    ? { from: scope.from, to: scope.to }
    : null;
}

/** Dealer stock age: rows and totals for the active or requested site. */
export function toMcpStockAgeReport(
  report: StockAgeReport,
  scope: McpReportScope,
) {
  return {
    site_id: scope.siteId,
    period: toMcpPeriod(scope),
    data: report.data.map((row) => ({
      id: row.id,
      make: row.make,
      model: row.model,
      year: row.year,
      vin: row.vin,
      plate: row.plate,
      inventory_role: row.inventory_role,
      stock_status: row.stock_status,
      days_in_stock: row.days_in_stock,
      missing_stock_in_date: row.missing_stock_in_date,
      stock_in_date: row.stock_in_date,
      age_bucket: row.age_bucket,
      cost_basis: row.cost_basis,
      asking_price: row.asking_price,
      location: row.location,
    })),
    totals: {
      over_90_count: report.summary.over_90_count,
      over_90_cost_basis: report.summary.over_90_cost_basis,
      bucket_counts: report.summary.bucket_counts,
    },
    meta: toMcpPageMeta(report.meta.total, scope),
  };
}

/**
 * Invoiced vehicle margins for the period. The totals are the USED block of the domain
 * totals, which holds every sale; the NEW and DEMO blocks are always empty for margins.
 */
export function toMcpStockMarginReport(
  report: StockMarginReport,
  scope: McpReportScope,
) {
  const used = report.totals.by_inventory_role.USED;
  return {
    site_id: scope.siteId,
    period: toMcpPeriod(scope),
    data: report.data.map((row) => ({
      id: row.id,
      sale_number: row.sale_number,
      vehicle_id: row.vehicle_id,
      make: row.make,
      model: row.model,
      year: row.year,
      invoice_date: row.invoice_date,
      sale_price: row.sale_price,
      cost_basis_snapshot: row.cost_basis_snapshot,
      gross_margin_eur: row.gross_margin_eur,
      gross_margin_percent: row.gross_margin_percent,
      days_to_sell: row.days_to_sell,
      margin_taxed: row.margin_taxed,
    })),
    totals: {
      count: used.count,
      gross_margin_known_count: used.gross_margin_known_count,
      gross_margin_unknown_count: used.gross_margin_unknown_count,
      gross_margin_total: used.gross_margin_total,
      gross_margin_average: used.gross_margin_average,
      gross_margin_percent_average: used.gross_margin_percent_average,
      sale_price_total: used.sale_price_total,
      sale_price_average: used.sale_price_average,
      cost_basis_total: used.cost_basis_total,
      cost_basis_average: used.cost_basis_average,
      days_to_sell_average: used.days_to_sell_average,
    },
    meta: toMcpPageMeta(report.meta.total, scope),
  };
}

/**
 * Workshop KPIs for the period, as totals across mechanics. Utilisation is Auslastung,
 * productivity is Leistungsgrad. Per-mechanic rows and slow movers are not returned.
 */
function formatRevenueAmounts(amounts: {
  net: { toFixed: (digits: number) => string };
  vat: { toFixed: (digits: number) => string };
  gross: { toFixed: (digits: number) => string };
}) {
  return {
    net: amounts.net.toFixed(2),
    vat: amounts.vat.toFixed(2),
    gross: amounts.gross.toFixed(2),
  };
}

function toMcpRevenueReportCore(
  report: RevenueReportResult | NonNullable<RevenueReportResult['previous']>,
) {
  return {
    period: report.period,
    site_id: report.site_id,
    totals: formatRevenueAmounts(report.totals),
    by_source: report.by_source.map((row) => ({
      source: row.source,
      ...formatRevenueAmounts(row),
    })),
    by_revenue_group: report.by_revenue_group.map((row) => ({
      name: row.name,
      ...formatRevenueAmounts(row),
    })),
    invoice_count: report.invoice_count,
  };
}

/** Revenue totals for a site-local period, split by source and revenue group. */
export function toMcpRevenueReport(report: RevenueReportResult) {
  return {
    ...toMcpRevenueReportCore(report),
    ...(report.previous
      ? { previous: toMcpRevenueReportCore(report.previous) }
      : {}),
  };
}

export function toMcpWorkshopKpiReport(
  report: WorkshopKpiReport,
  siteId: string,
) {
  const { totals, parts_turnover: partsTurnover, meta } = report;
  return {
    site_id: siteId,
    period: {
      from: meta.from,
      to: meta.to,
      timezone: meta.timezone,
    },
    utilisation_percent: totals.utilisation_percent,
    productivity_percent: totals.productivity_percent,
    revenue_per_order: totals.average_net_revenue_per_order,
    closed_orders: totals.closed_orders,
    labor_net_revenue: totals.labor_net_revenue,
    parts_net_revenue: totals.parts_net_revenue,
    available_hours: totals.available_hours,
    clocked_hours: totals.clocked_hours,
    sold_hours: totals.sold_hours,
    open_labor_entry_count: totals.open_labor_entry_count,
    unassigned_mechanic_count: meta.unassigned_mechanic_count,
    parts_turnover: {
      issued_cost: partsTurnover.issued_cost,
      average_stock_value: partsTurnover.average_stock_value,
      turnover: partsTurnover.turnover,
      unvalued_stock_item_count: partsTurnover.unvalued_stock_item_count,
    },
  };
}

/** The part of a Pickerl due row that the list reads. */
export type McpPickerlDueVehicle = {
  id: string;
  make: string;
  model: string;
  plate: string | null;
  customer: Pick<
    McpInvoiceCustomer,
    'type' | 'company_name' | 'first_name' | 'last_name'
  > | null;
  pickerl_due: { due_month: string | null; status: PickerlDueStatus };
};

const PICKERL_STATUS_RANK: Record<PickerlDueStatus, number> = {
  OVERDUE: 1,
  DUE_SOON: 2,
  OK: 3,
  UNKNOWN: 4,
};

/**
 * Overdue first, then by due month, as the domain orders the list. The vehicle ID breaks
 * ties, so every offset page sees the same order and no row repeats or goes missing.
 */
export function sortPickerlDueRows<T extends McpPickerlDueVehicle>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (left, right) =>
      PICKERL_STATUS_RANK[left.pickerl_due.status] -
        PICKERL_STATUS_RANK[right.pickerl_due.status] ||
      (left.pickerl_due.due_month ?? '9999-99').localeCompare(
        right.pickerl_due.due_month ?? '9999-99',
      ) ||
      left.id.localeCompare(right.id),
  );
}

/**
 * One due row: the vehicle, the customer's name, the status, and the due date. The Pickerl
 * due month is a sticker month, so the due date is its last day, as the list compares it.
 */
export function toMcpPickerlDueRow(vehicle: McpPickerlDueVehicle) {
  const dueMonth = vehicle.pickerl_due.due_month;
  return {
    vehicle: {
      id: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      plate: vehicle.plate,
    },
    customer_name: vehicle.customer ? mcpCustomerName(vehicle.customer) : null,
    status: vehicle.pickerl_due.status,
    due_date: dueMonth
      ? endOfMonthUtc(parseYearMonthString(dueMonth)).toISOString().slice(0, 10)
      : null,
  };
}

const NOVA_NOTE =
  'Preview only: nothing is saved and no invoice is changed. The Steuerberater must still confirm this NoVA amount while any unconfirmed rule applies.';
const NOVA_NOTE_UNVERIFIED =
  ' An unconfirmed rule applies to this calculation (see warnings), so the Steuerberater must confirm the amount before it is used.';

/** The NoVA note is always present. It names the Steuerberater, and says more while a rule is unconfirmed. */
export function novaPreviewNote(hasUnverifiedRules: boolean): string {
  return hasUnverifiedRules ? `${NOVA_NOTE}${NOVA_NOTE_UNVERIFIED}` : NOVA_NOTE;
}

/** A NoVA calculation preview. Amounts are EUR decimal strings with two places. */
export function toMcpNovaPreview(
  input: { vehicleId: string; netPriceEur: number },
  result: NovaCalculateResult,
) {
  return {
    vehicle_id: input.vehicleId,
    net_price_eur: input.netPriceEur.toFixed(2),
    nova_eur: result.novaAmountEuro.toFixed(2),
    rate_percent: result.ratePercentApplied,
    effective_co2_g_km: result.effectiveCo2GramsPerKm,
    tariff_version_id: result.tariffVersionId,
    applied_rule_ids: result.appliedRuleIds,
    warnings: result.warnings,
    has_unverified_rules: result.hasUnverifiedRules,
    note: novaPreviewNote(result.hasUnverifiedRules),
  };
}
