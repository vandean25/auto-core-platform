import { Prisma } from '@prisma/client';
import type {
  WarrantyClaim,
  WarrantyClaimLine,
  WarrantyClaimStatus,
  WarrantyClaimType,
  WorkshopLineItemType,
} from '@prisma/client';

export type WarrantyClaimRow = WarrantyClaim & { lines: WarrantyClaimLine[] };

export type WarrantyClaimLineResponse = {
  id: string;
  workshopTaskLineItemId: string;
  lineType: WorkshopLineItemType;
  itemNo: string;
  description: string;
  quantity: string;
  unitPrice: string;
  netAmount: string;
};

export type WarrantyClaimResponse = {
  id: string;
  workshopOrderId: string;
  type: WarrantyClaimType;
  status: WarrantyClaimStatus;
  complaint: string | null;
  causeCorrection: string | null;
  claimedAmountNet: string | null;
  linesNetAmount: string;
  externalReference: string | null;
  decisionDate: string | null;
  decisionNote: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: WarrantyClaimLineResponse[];
};

function toIsoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Plain, JSON-safe view of a claim. Money and quantities are fixed-decimal strings and
 * dates are ISO strings, so the same object serves the API response and the audit snapshot.
 */
export function toWarrantyClaimResponse(
  row: WarrantyClaimRow,
): WarrantyClaimResponse {
  const linesNetAmount = row.lines.reduce(
    (sum, line) => sum.plus(line.net_amount),
    new Prisma.Decimal(0),
  );

  return {
    id: row.id,
    workshopOrderId: row.workshop_order_id,
    type: row.type,
    status: row.status,
    complaint: row.complaint,
    causeCorrection: row.cause_correction,
    claimedAmountNet: row.claimed_amount_net?.toFixed(2) ?? null,
    linesNetAmount: linesNetAmount.toFixed(2),
    externalReference: row.external_reference,
    decisionDate: row.decision_date ? toIsoDay(row.decision_date) : null,
    decisionNote: row.decision_note,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    closedAt: row.closed_at?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      workshopTaskLineItemId: line.workshop_task_line_item_id,
      lineType: line.line_type,
      itemNo: line.item_no,
      description: line.description,
      quantity: line.quantity.toFixed(3),
      unitPrice: line.unit_price.toFixed(2),
      netAmount: line.net_amount.toFixed(2),
    })),
  };
}
