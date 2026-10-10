import {
  Prisma,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { DEFAULT_VAT_RATE } from '../invoices/invoice-creation.helpers.js';
import {
  buildTotalsSnapshot,
  halfUpTax,
  moneyString,
  quantityString,
  toMoney,
} from '../invoices/invoice-snapshot-v2.helpers.js';

/** One priced line as it appears on the estimate. Money fields are strings with two decimals. */
export type WorkshopEstimateLine = {
  source_line_id: string;
  type: WorkshopLineItemType;
  item_no: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  net: string;
  tax: string;
  gross: string;
};

export type EstimateSourceLine = {
  id: string;
  type: WorkshopLineItemType;
  item_no: string;
  description: string;
  quantity: Prisma.Decimal;
  unit_price: Prisma.Decimal;
  part_execution_status: WorkshopPartLineExecutionStatus | null;
};

export type EstimateSourceTask = {
  line_items: EstimateSourceLine[];
};

/**
 * Labor and part lines of the order. Cancelled part lines are dropped, the same
 * rule the invoice draft uses, so an estimate and the later invoice price the
 * same work.
 */
export function collectEstimateSourceLines(
  tasks: EstimateSourceTask[],
): EstimateSourceLine[] {
  return tasks
    .flatMap((task) => task.line_items)
    .filter(
      (line) =>
        line.part_execution_status !==
        WorkshopPartLineExecutionStatus.CANCELLED,
    );
}

export function buildWorkshopEstimateLines(
  sources: EstimateSourceLine[],
  taxRate: Prisma.Decimal = DEFAULT_VAT_RATE,
): WorkshopEstimateLine[] {
  return sources.map((line) => {
    const quantity = toMoney(line.quantity);
    const unitPrice = toMoney(line.unit_price);
    const net = quantity.mul(unitPrice);
    const tax = halfUpTax(net, taxRate);
    return {
      source_line_id: line.id,
      type: line.type,
      item_no: line.item_no,
      description: line.description,
      quantity: quantityString(quantity),
      unit_price: moneyString(unitPrice),
      tax_rate: moneyString(taxRate),
      net: moneyString(net),
      tax: moneyString(tax),
      gross: moneyString(net.add(tax)),
    };
  });
}

export function buildWorkshopEstimateTotals(lines: WorkshopEstimateLine[]) {
  return buildTotalsSnapshot(
    lines.map((line) => ({
      net: line.net,
      tax: line.tax,
      gross: line.gross,
      tax_rate: line.tax_rate,
    })),
  );
}
