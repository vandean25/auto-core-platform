import { BadRequestException } from '@nestjs/common';

export type VehicleInspectionRecordFieldInput = {
  inspected_on: string;
  plaketten_valid_until_year: number;
  plaketten_valid_until_month: number;
};

function toUtcDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function yearMonthOrdinal(year: number, month: number): number {
  return year * 12 + month;
}

export function assertVehicleInspectionRecordFields(
  dto: VehicleInspectionRecordFieldInput,
  referenceDate: Date,
): void {
  const inspectedOn = toUtcDateOnly(dto.inspected_on);
  if (Number.isNaN(inspectedOn.getTime())) {
    throw new BadRequestException('inspected_on must be a valid date');
  }

  const referenceUtc = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    ),
  );
  if (inspectedOn.getTime() > referenceUtc.getTime()) {
    throw new BadRequestException('inspected_on cannot be in the future');
  }

  const dueOrdinal = yearMonthOrdinal(
    dto.plaketten_valid_until_year,
    dto.plaketten_valid_until_month,
  );
  const inspectedOrdinal = yearMonthOrdinal(
    inspectedOn.getUTCFullYear(),
    inspectedOn.getUTCMonth() + 1,
  );
  if (dueOrdinal < inspectedOrdinal) {
    throw new BadRequestException(
      'plaketten_valid_until cannot be before the inspection month',
    );
  }
}
