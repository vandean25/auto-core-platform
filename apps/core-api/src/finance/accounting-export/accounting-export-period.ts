import { UnprocessableEntityException } from '@nestjs/common';

export function parseIsoDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new UnprocessableEntityException({
      code: 'EXPORT_INVALID_RANGE',
      message: 'Invalid export date range.',
    });
  }
  return parsed;
}

export function assertValidExportDateRange(
  dateFrom: string,
  dateTo: string,
): {
  dateFrom: Date;
  dateTo: Date;
} {
  const from = parseIsoDateOnly(dateFrom);
  const to = parseIsoDateOnly(dateTo);

  if (from > to) {
    throw new UnprocessableEntityException({
      code: 'EXPORT_INVALID_RANGE',
      message: 'dateFrom must be less than or equal to dateTo.',
    });
  }

  if (from.getUTCFullYear() !== to.getUTCFullYear()) {
    throw new UnprocessableEntityException({
      code: 'EXPORT_INVALID_RANGE',
      message: 'Export range must stay within one fiscal year.',
    });
  }

  return { dateFrom: from, dateTo: to };
}

export function assertClosedExportPeriod(
  dateTo: Date,
  lockDate: Date | null | undefined,
): void {
  if (!lockDate) {
    throw new UnprocessableEntityException({
      code: 'EXPORT_PERIOD_NOT_CLOSED',
      message: 'Export period is not closed.',
    });
  }

  const lockDateOnly = new Date(
    Date.UTC(
      lockDate.getUTCFullYear(),
      lockDate.getUTCMonth(),
      lockDate.getUTCDate(),
    ),
  );
  const dateToOnly = new Date(
    Date.UTC(
      dateTo.getUTCFullYear(),
      dateTo.getUTCMonth(),
      dateTo.getUTCDate(),
    ),
  );

  if (dateToOnly > lockDateOnly) {
    throw new UnprocessableEntityException({
      code: 'EXPORT_PERIOD_NOT_CLOSED',
      message: 'Export period is not closed.',
      lockDate: lockDate.toISOString(),
    });
  }
}

export function rangesOverlap(
  leftFrom: Date,
  leftTo: Date,
  rightFrom: Date,
  rightTo: Date,
): boolean {
  return leftFrom <= rightTo && rightFrom <= leftTo;
}
