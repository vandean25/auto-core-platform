import { WorkshopLineItemType } from '@prisma/client';

/**
 * Labor margin and efficiency for one workshop order (AUT-40).
 *
 * Mirrors `calculateTaskRawTotals` and the order-level labor analytics in
 * `apps/core-web/src/pages/workshop/hooks/useWorkshopCalculations.ts`, so the
 * backend and the checkout view agree on the same line items.
 *
 * Only the workshop order detail (REST) and the MCP `get_workshop_order` read
 * use this helper. Both surfaces already return `internalCostRate` to the roles
 * that may see cost today: the global JwtAuthGuard keeps TECH out of the
 * back-office order read, and MCP allows OWNER, ADMIN, and SALES. The mechanic
 * surfaces deliberately hide pricing.
 */

export type WorkshopLaborLineInput = {
  id: string;
  type: WorkshopLineItemType;
  qty: number;
  unitPrice: number;
  standardAw: number | null;
  actualHours: number | null;
  internalCostRate: number | null;
};

export type WorkshopLaborTaskInput = {
  id: string;
  lineItems?: WorkshopLaborLineInput[] | null;
};

export type WorkshopLaborSummaryLine = {
  id: string;
  task_id: string;
  revenue: number;
  cost: number | null;
  margin: number | null;
  efficiency: number | null;
};

export type WorkshopLaborSummaryTotals = {
  revenue: number;
  cost: number | null;
  margin: number | null;
  margin_percent: number | null;
  standard_hours: number;
  actual_hours: number;
  efficiency: number | null;
};

export type WorkshopLaborSummary = {
  line_items: WorkshopLaborSummaryLine[];
  totals: WorkshopLaborSummaryTotals;
  has_cost_data: boolean;
};

/** Revenue, internal cost, margin, and efficiency of one labor line. */
export function summarizeWorkshopLaborLine(
  taskId: string,
  line: WorkshopLaborLineInput,
): WorkshopLaborSummaryLine {
  const revenue = line.qty * line.unitPrice;
  const cost =
    line.internalCostRate === null
      ? null
      : (line.actualHours ?? line.qty) * line.internalCostRate;
  const efficiency =
    line.standardAw === null ||
    line.actualHours === null ||
    line.actualHours === 0
      ? null
      : line.standardAw / line.actualHours;

  return {
    id: line.id,
    task_id: taskId,
    revenue,
    cost,
    margin: cost === null ? null : revenue - cost,
    efficiency,
  };
}

function sumLaborHours(
  tasks: readonly WorkshopLaborTaskInput[],
  pick: (line: WorkshopLaborLineInput) => number | null,
): number {
  return tasks.reduce(
    (sum, task) =>
      sum +
      (task.lineItems ?? [])
        .filter((line) => line.type === WorkshopLineItemType.LABOR)
        .reduce((hours, line) => hours + (pick(line) ?? 0), 0),
    0,
  );
}

/** Order-level labor summary across every task and its LABOR lines. */
export function computeWorkshopLaborSummary(
  tasks: readonly WorkshopLaborTaskInput[],
): WorkshopLaborSummary {
  const laborLines = tasks.flatMap((task) =>
    (task.lineItems ?? [])
      .filter((line) => line.type === WorkshopLineItemType.LABOR)
      .map((line) => summarizeWorkshopLaborLine(task.id, line)),
  );
  const costLines = laborLines.filter(
    (line): line is WorkshopLaborSummaryLine & { cost: number } =>
      line.cost !== null,
  );
  const efficiencies = laborLines
    .map((line) => line.efficiency)
    .filter((efficiency): efficiency is number => efficiency !== null);

  const revenue = laborLines.reduce((sum, line) => sum + line.revenue, 0);
  // Unknown per-line costs must not be silently treated as zero cost:
  // the order totals are only present when every labor line has a rate.
  const cost =
    laborLines.length > 0 && costLines.length === laborLines.length
      ? costLines.reduce((sum, line) => sum + line.cost, 0)
      : null;
  const margin = cost === null ? null : revenue - cost;

  return {
    line_items: laborLines,
    totals: {
      revenue,
      cost,
      margin,
      margin_percent:
        margin === null || revenue <= 0 ? null : (margin / revenue) * 100,
      standard_hours: sumLaborHours(tasks, (line) => line.standardAw),
      actual_hours: sumLaborHours(tasks, (line) => line.actualHours),
      efficiency:
        efficiencies.length === 0
          ? null
          : efficiencies.reduce((sum, value) => sum + value, 0) /
            efficiencies.length,
    },
    has_cost_data: costLines.length > 0,
  };
}
