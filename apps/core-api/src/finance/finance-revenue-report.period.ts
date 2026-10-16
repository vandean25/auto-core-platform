const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string, label: string): void {
  if (!ISO_DATE.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar date`);
  }
}

export function inclusiveDayCount(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00.000Z`) -
      Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000 +
    1
  );
}

export function addCalendarDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function previousPeriodOfSameLength(
  from: string,
  to: string,
): { from: string; to: string } {
  const length = inclusiveDayCount(from, to);
  const previousTo = addCalendarDays(from, -1);
  const previousFrom = addCalendarDays(previousTo, -(length - 1));
  return { from: previousFrom, to: previousTo };
}

export function serverLocalMonthBounds(now = new Date()): {
  from: string;
  to: string;
  start: Date;
  periodLabel: string;
} {
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const periodLabel = `${year}-${String(month + 1).padStart(2, '0')}`;
  return { from, to, start, periodLabel };
}
