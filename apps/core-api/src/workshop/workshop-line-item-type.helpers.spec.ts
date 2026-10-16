import { WorkshopLineItemType } from '@prisma/client';
import {
  defaultRevenueGroupNameForWorkshopLineType,
  partExecutionStatusForNewLine,
  resolveWorkshopLineItemType,
  workshopFeeRevenueGroupName,
} from './workshop-line-item-type.helpers.js';

describe('workshop-line-item-type.helpers', () => {
  it('maps MCP line types to Prisma enums', () => {
    expect(resolveWorkshopLineItemType('LABOR')).toBe(WorkshopLineItemType.LABOR);
    expect(resolveWorkshopLineItemType('PART')).toBe(WorkshopLineItemType.PART);
    expect(resolveWorkshopLineItemType('FEE')).toBe(WorkshopLineItemType.FEE);
    expect(resolveWorkshopLineItemType('unknown')).toBe(
      WorkshopLineItemType.PART,
    );
  });

  it('assigns revenue groups for labor and fee lines', () => {
    expect(
      defaultRevenueGroupNameForWorkshopLineType(WorkshopLineItemType.LABOR),
    ).toBe('Labor / workshop services');
    expect(
      defaultRevenueGroupNameForWorkshopLineType(WorkshopLineItemType.FEE),
    ).toBe(workshopFeeRevenueGroupName());
    expect(
      defaultRevenueGroupNameForWorkshopLineType(WorkshopLineItemType.PART),
    ).toBeNull();
  });

  it('only parts get a pick status on create', () => {
    expect(partExecutionStatusForNewLine(WorkshopLineItemType.PART)).toBe(
      'PENDING_PICK',
    );
    expect(partExecutionStatusForNewLine(WorkshopLineItemType.FEE)).toBeNull();
    expect(partExecutionStatusForNewLine(WorkshopLineItemType.LABOR)).toBeNull();
  });
});
