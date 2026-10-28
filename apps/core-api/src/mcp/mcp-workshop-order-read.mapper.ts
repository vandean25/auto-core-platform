import { Prisma, WorkshopEstimateStatus } from '@prisma/client';
import { localDateStartUtc } from '../workshop/workshop-kpi-reports.math.js';
import type {
  WorkshopLaborSummary,
  WorkshopLaborSummaryLine,
  WorkshopLaborSummaryTotals,
} from '../workshop/workshop-labor-summary.helpers.js';
import type { WorkshopOrderWithRelations } from '../workshop/workshop-order.helpers.js';
import { normalizeWorkshopOrder } from '../workshop/workshop-order.helpers.js';

export const MCP_ESTIMATE_STATUS_FILTERS = [
  'SENT',
  'APPROVED',
  'DECLINED',
  'EXPIRED',
] as const;

export type McpEstimateStatusFilter =
  (typeof MCP_ESTIMATE_STATUS_FILTERS)[number];

export type CurrentEstimateVersionRow = {
  id: string;
  version: number;
  status: WorkshopEstimateStatus;
  sent_at: Date | null;
  valid_until: Date | null;
  total_gross: Prisma.Decimal | null;
  estimate: {
    estimate_number: string;
    workshop_order_id: string;
  };
};

/** Calendar day after `isoDate`, still YYYY-MM-DD. */
export function nextIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Inclusive site-local dates as an exclusive UTC `[gte, lt)` interval. */
export function siteLocalInclusiveDateRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): { gte: Date; lt: Date } | null {
  if (!from && !to) {
    return null;
  }
  if (!from || !to) {
    return null;
  }
  return {
    gte: localDateStartUtc(from, timeZone),
    lt: localDateStartUtc(nextIsoDate(to), timeZone),
  };
}

export function isInstantInSiteLocalDateRange(
  instant: Date | null,
  range: { gte: Date; lt: Date },
): boolean {
  if (!instant) {
    return false;
  }
  const ms = instant.getTime();
  return ms >= range.gte.getTime() && ms < range.lt.getTime();
}

/** Matches workshop estimate reads: SENT past `valid_until` is reported as EXPIRED. */
export function effectiveEstimateStatus(
  version: {
    status: WorkshopEstimateStatus;
    valid_until: Date | null;
  },
  now: Date = new Date(),
): WorkshopEstimateStatus {
  if (
    version.status === WorkshopEstimateStatus.SENT &&
    version.valid_until !== null &&
    version.valid_until.getTime() < now.getTime()
  ) {
    return WorkshopEstimateStatus.EXPIRED;
  }
  return version.status;
}

export function matchesEstimateStatusFilter(
  version: CurrentEstimateVersionRow,
  filter: McpEstimateStatusFilter,
  now: Date,
): boolean {
  const effective = effectiveEstimateStatus(version, now);
  return effective === filter;
}

export function toMcpEstimateSummary(
  version: CurrentEstimateVersionRow,
  now: Date = new Date(),
) {
  return {
    number: version.estimate.estimate_number,
    version: version.version,
    status: effectiveEstimateStatus(version, now),
    sent_at: version.sent_at ? version.sent_at.toISOString() : null,
    valid_until: version.valid_until ? version.valid_until.toISOString() : null,
    total_gross: version.total_gross ? version.total_gross.toFixed(2) : null,
  };
}

export function toMcpWorkshopOrderListRow(
  order: WorkshopOrderWithRelations,
  estimate: CurrentEstimateVersionRow | null,
  now: Date = new Date(),
) {
  const normalized = normalizeWorkshopOrder(order);
  return {
    ...normalized,
    estimate: estimate ? toMcpEstimateSummary(estimate, now) : null,
  };
}

function mcpDecimal(value: number): string {
  return value.toFixed(2);
}

function mcpNullableDecimal(value: number | null): string | null {
  return value === null ? null : mcpDecimal(value);
}

function toMcpLaborSummaryLine(line: WorkshopLaborSummaryLine) {
  return {
    id: line.id,
    task_id: line.task_id,
    revenue: mcpDecimal(line.revenue),
    cost: mcpNullableDecimal(line.cost),
    margin: mcpNullableDecimal(line.margin),
    efficiency: mcpNullableDecimal(line.efficiency),
  };
}

function toMcpLaborSummaryTotals(totals: WorkshopLaborSummaryTotals) {
  return {
    revenue: mcpDecimal(totals.revenue),
    cost: mcpNullableDecimal(totals.cost),
    margin: mcpNullableDecimal(totals.margin),
    margin_percent: mcpNullableDecimal(totals.margin_percent),
    standard_hours: mcpDecimal(totals.standard_hours),
    actual_hours: mcpDecimal(totals.actual_hours),
    efficiency: mcpNullableDecimal(totals.efficiency),
  };
}

/** Labor margin and efficiency of the detail read, with MCP decimal strings. */
export function toMcpWorkshopLaborSummary(summary: WorkshopLaborSummary) {
  return {
    line_items: summary.line_items.map(toMcpLaborSummaryLine),
    totals: toMcpLaborSummaryTotals(summary.totals),
    has_cost_data: summary.has_cost_data,
  };
}
