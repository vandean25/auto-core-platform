import { Prisma } from '@prisma/client';
import {
  moneyString,
  toMoney,
} from '../invoices/invoice-snapshot-v2.helpers.js';

export type WorkshopEstimateOverrunWarning = {
  total_over_threshold: boolean;
  new_work_lines: boolean;
  approved_total_gross: string;
  current_total_gross: string;
  threshold_pct: string;
  new_line_count: number;
};

/**
 * Warning for the order, derived on read (nothing is persisted here; the
 * tracking fields and "Kunden informiert" belong to AUT-355). Compares the live
 * order with the approved version: gross total above approved × (1 + threshold),
 * or work lines that the approved version did not contain. The threshold is a
 * guide value, not statutory (ADR-0025 §1, § 1170a ABGB).
 */
export function computeWorkshopEstimateOverrun(params: {
  approved: {
    total_gross: string;
    lines: Array<{ source_line_id: string }>;
  } | null;
  currentLines: Array<{ source_line_id: string; gross: string }>;
  thresholdPct: Prisma.Decimal | string | number;
}): WorkshopEstimateOverrunWarning | null {
  if (!params.approved) {
    return null;
  }

  const approvedGross = toMoney(params.approved.total_gross);
  const currentGross = params.currentLines.reduce(
    (sum, line) => sum.add(toMoney(line.gross)),
    new Prisma.Decimal(0),
  );
  const thresholdPct = toMoney(params.thresholdPct);
  const limit = approvedGross.mul(
    new Prisma.Decimal(1).add(thresholdPct.div(100)),
  );

  const approvedLineIds = new Set(
    params.approved.lines.map((line) => line.source_line_id),
  );
  const newLineCount = params.currentLines.filter(
    (line) => !approvedLineIds.has(line.source_line_id),
  ).length;

  const totalOverThreshold = currentGross.greaterThan(limit);
  if (!totalOverThreshold && newLineCount === 0) {
    return null;
  }

  return {
    total_over_threshold: totalOverThreshold,
    new_work_lines: newLineCount > 0,
    approved_total_gross: moneyString(approvedGross),
    current_total_gross: moneyString(currentGross),
    threshold_pct: moneyString(thresholdPct),
    new_line_count: newLineCount,
  };
}
