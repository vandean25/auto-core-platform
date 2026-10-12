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

export function exclusiveUtcEndOfDateOnly(dateTo: Date): Date {
  return new Date(dateTo.getTime() + 24 * 60 * 60 * 1000);
}

export function buildExportDocumentDateFilter(
  dateFrom: Date,
  dateTo: Date,
): { gte: Date; lt: Date } {
  return {
    gte: dateFrom,
    lt: exclusiveUtcEndOfDateOnly(dateTo),
  };
}

function fiscalYearForDate(date: Date, fiscalYearStartMonth: number): number {
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  return month < fiscalYearStartMonth ? year - 1 : year;
}

export function assertValidExportDateRange(
  dateFrom: string,
  dateTo: string,
  fiscalYearStartMonth = 1,
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

  if (
    fiscalYearForDate(from, fiscalYearStartMonth) !==
    fiscalYearForDate(to, fiscalYearStartMonth)
  ) {
    throw new UnprocessableEntityException({
      code: 'EXPORT_INVALID_RANGE',
      message: 'Export range must stay within one fiscal year.',
    });
  }

  return { dateFrom: from, dateTo: to };
}

function utcDayOf(value: Date): number {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

export function isExportPeriodClosed(
  dateTo: Date,
  lockDate: Date | null | undefined,
): boolean {
  if (!lockDate) {
    return false;
  }
  return utcDayOf(dateTo) <= utcDayOf(lockDate);
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

  if (!isExportPeriodClosed(dateTo, lockDate)) {
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
