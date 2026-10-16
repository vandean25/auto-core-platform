import { Prisma, WorkshopLineItemType } from '@prisma/client';
import type { Prisma as PrismaNamespace } from '@prisma/client';

export const LOANER_FEE_ITEM_NO = 'LEIH';
export const LOANER_FEE_DESCRIPTION = 'Leihwagen';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Billable loaner days: at least one; optional override from MCP `quantity_days`. */
export function resolveLoanerFeeQuantityDays(
  plannedFromIso: string,
  plannedToIso: string,
  quantityDaysOverride?: number,
): number {
  if (
    quantityDaysOverride !== undefined &&
    Number.isFinite(quantityDaysOverride) &&
    quantityDaysOverride > 0
  ) {
    return quantityDaysOverride;
  }
  const fromMs = Date.parse(plannedFromIso);
  const toMs = Date.parse(plannedToIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return 1;
  }
  const rawDays = Math.ceil((toMs - fromMs) / MS_PER_DAY);
  return Math.max(1, rawDays);
}

export function buildLoanerFeeLineItemData(params: {
  tenantId: string;
  workshopTaskId: string;
  unitPriceCents: number;
  quantityDays: number;
}): PrismaNamespace.WorkshopTaskLineItemUncheckedCreateInput {
  const unitPrice = new Prisma.Decimal(params.unitPriceCents).div(100);
  return {
    tenant_id: params.tenantId,
    workshop_task_id: params.workshopTaskId,
    type: WorkshopLineItemType.FEE,
    part_execution_status: null,
    item_no: LOANER_FEE_ITEM_NO,
    description: LOANER_FEE_DESCRIPTION,
    quantity: new Prisma.Decimal(params.quantityDays),
    unit_price: unitPrice,
    labor_operation_id: null,
  };
}
