import {
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';

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
  value: string,
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
  return WorkshopLineItemType.PART;
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
  type: string | null | undefined,
): string | null {
  if (type === WorkshopLineItemType.LABOR) {
    return WORKSHOP_LABOR_REVENUE_GROUP_NAME;
  }
  if (type === WorkshopLineItemType.FEE) {
    return workshopFeeRevenueGroupName();
  }
  return null;
}
