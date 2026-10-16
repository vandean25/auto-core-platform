import { WorkshopLineItemType, WorkshopPartLineExecutionStatus } from '@prisma/client';

export const WORKSHOP_LABOR_REVENUE_GROUP_NAME = 'Labor / workshop services';

const DEFAULT_WORKSHOP_FEE_REVENUE_GROUP_NAME =
  'Workshop fees / ancillary services';

export function workshopFeeRevenueGroupName(): string {
  const configured = process.env.WORKSHOP_FEE_REVENUE_GROUP_NAME?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_WORKSHOP_FEE_REVENUE_GROUP_NAME;
}

export function resolveWorkshopLineItemType(
  value: string | WorkshopLineItemType,
): WorkshopLineItemType {
  if (value === WorkshopLineItemType.LABOR) {
    return WorkshopLineItemType.LABOR;
  }
  if (value === WorkshopLineItemType.PART) {
    return WorkshopLineItemType.PART;
  }
  if (value === WorkshopLineItemType.FEE) {
    return WorkshopLineItemType.FEE;
  }
  throw new Error(`Unsupported workshop line item type: ${value}`);
}

export function partExecutionStatusForNewLine(
  type: WorkshopLineItemType,
): WorkshopPartLineExecutionStatus | null {
  if (type === WorkshopLineItemType.PART) {
    return WorkshopPartLineExecutionStatus.PENDING_PICK;
  }
  return null;
}

export function defaultRevenueGroupNameForWorkshopLineType(
  type: WorkshopLineItemType | string | null | undefined,
): string | null {
  if (type === WorkshopLineItemType.LABOR || type === 'LABOR') {
    return WORKSHOP_LABOR_REVENUE_GROUP_NAME;
  }
  if (type === WorkshopLineItemType.FEE || type === 'FEE') {
    return workshopFeeRevenueGroupName();
  }
  return null;
}

export function isWorkshopLaborRevenueGroupName(
  revenueGroupName: string | null | undefined,
): boolean {
  return revenueGroupName === WORKSHOP_LABOR_REVENUE_GROUP_NAME;
}
