import type { TyreSeason, TyreStorageSettings } from '@prisma/client';

export type TyreSwapSettingsSlice = Pick<
  TyreStorageSettings,
  | 'summer_swap_month'
  | 'summer_swap_day'
  | 'winter_swap_month'
  | 'winter_swap_day'
>;

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function nextOnOrAfter(
  month: number,
  day: number,
  asOfUtc: Date,
): Date {
  const year = asOfUtc.getUTCFullYear();
  let candidate = utcDate(year, month, day);
  if (candidate.getTime() < startOfUtcDay(asOfUtc).getTime()) {
    candidate = utcDate(year + 1, month, day);
  }
  return candidate;
}

function startOfUtcDay(date: Date): Date {
  return utcDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

export function derivePlannedSwapOn(
  season: TyreSeason,
  settings: TyreSwapSettingsSlice,
  asOf: Date,
): Date | null {
  if (season === 'ALL_SEASON') {
    return null;
  }
  if (season === 'WINTER') {
    return nextOnOrAfter(
      settings.summer_swap_month,
      settings.summer_swap_day,
      asOf,
    );
  }
  return nextOnOrAfter(
    settings.winter_swap_month,
    settings.winter_swap_day,
    asOf,
  );
}

export function isDueForSwap(
  plannedSwapOn: Date | null,
  dueForSwapDays: number,
  asOf: Date,
): boolean {
  if (!plannedSwapOn) {
    return false;
  }
  const windowEnd = startOfUtcDay(asOf);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + dueForSwapDays);
  const swapDay = startOfUtcDay(plannedSwapOn);
  return swapDay.getTime() <= windowEnd.getTime();
}
