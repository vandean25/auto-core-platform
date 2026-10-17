import { VehiclePickerlQueryBuilder } from '../vehicle-pickerl-query.builder.js';
import {
  computePickerlDue,
  type PickerlVehicleInput,
} from './compute-pickerl-due.js';
import {
  addMonths,
  compareUtcDates,
  endOfMonthUtc,
  formatYearMonth,
  toYearMonthFromDate,
  type YearMonth,
} from './pickerl-date.util.js';

const FIXTURE_FIRST_REGISTRATION = '2019-06-01';

export type PlaketteMonth = YearMonth;
type PickerlWindowDays = 30 | 60 | 90;

export function pickerlWindowEndDate(
  today: Date,
  windowDays: PickerlWindowDays,
): Date {
  const { windowEndDate } = VehiclePickerlQueryBuilder.buildCustomerWhere(
    'fixture-tenant',
    { window: windowDays },
    today,
  );
  if (!windowEndDate) {
    throw new Error('expected a window end date');
  }
  return windowEndDate;
}

/**
 * Picks a sticker month whose last day lies in (window(lowerExclusive), window(upperInclusive)]
 * using the same month-end rule as `VehiclePickerlQueryBuilder.isWithinWindow`.
 */
export function pickPlaketteMonthInWindow(
  today: Date,
  lowerWindowDaysExclusive: PickerlWindowDays | null,
  upperWindowDaysInclusive: PickerlWindowDays,
): PlaketteMonth {
  const upperBound = pickerlWindowEndDate(today, upperWindowDaysInclusive);
  const lowerBound =
    lowerWindowDaysExclusive === null
      ? null
      : pickerlWindowEndDate(today, lowerWindowDaysExclusive);

  let candidate = toYearMonthFromDate(upperBound);
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const monthEnd = endOfMonthUtc(candidate);
    const withinUpper = compareUtcDates(monthEnd, upperBound) <= 0;
    const aboveLower =
      lowerBound === null || compareUtcDates(monthEnd, lowerBound) > 0;
    if (withinUpper && aboveLower) {
      return candidate;
    }
    candidate = addMonths(candidate, -1);
  }
  throw new Error(
    `No plakette month for window (${String(lowerWindowDaysExclusive)}, ${upperWindowDaysInclusive}]`,
  );
}

/** Sticker month whose month-end is strictly after the given window end. */
export function pickPlaketteMonthAfterWindow(
  today: Date,
  windowDays: PickerlWindowDays,
): PlaketteMonth {
  const bound = pickerlWindowEndDate(today, windowDays);
  let candidate = addMonths(toYearMonthFromDate(bound), 1);
  for (let attempt = 0; attempt < 36; attempt += 1) {
    if (compareUtcDates(endOfMonthUtc(candidate), bound) > 0) {
      return candidate;
    }
    candidate = addMonths(candidate, 1);
  }
  throw new Error(`No plakette month after window ${windowDays}`);
}

function pickPlaketteMonthForOkStatus(today: Date): PlaketteMonth {
  const vehicle: PickerlVehicleInput = {
    first_registration_date: FIXTURE_FIRST_REGISTRATION,
  };
  let candidate = pickPlaketteMonthAfterWindow(today, 90);
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const status = computePickerlDue(
      vehicle,
      [
        {
          inspected_on: '2020-01-01',
          plaketten_valid_until_year: candidate.year,
          plaketten_valid_until_month: candidate.month,
        },
      ],
      today,
    ).status;
    if (status === 'OK') {
      return candidate;
    }
    candidate = addMonths(candidate, 1);
  }
  throw new Error('No plakette month yields OK status');
}

/** False when no calendar month-end falls strictly between the 30- and 60-day window ends. */
export function hasStrictDue60Bucket(today: Date): boolean {
  try {
    pickPlaketteMonthInWindow(today, 30, 60);
    return true;
  } catch {
    return false;
  }
}

function pickDue60Month(today: Date): PlaketteMonth {
  try {
    if (hasStrictDue60Bucket(today)) {
      return pickPlaketteMonthInWindow(today, 30, 60);
    }
    return pickPlaketteMonthInWindow(today, 60, 90);
  } catch {
    return pickPlaketteMonthInWindow(today, null, 60);
  }
}

function pickDue90Month(today: Date, due60: PlaketteMonth): PlaketteMonth {
  try {
    return pickPlaketteMonthInWindow(today, 60, 90);
  } catch {
    return due60;
  }
}

export function pickerlDueFixturesForToday(today: Date) {
  const due30 = pickPlaketteMonthInWindow(today, null, 30);
  const due60 = pickDue60Month(today);
  const due90 = pickDue90Month(today, due60);
  return {
    due30,
    due60,
    due90,
    ok: pickPlaketteMonthForOkStatus(today),
  };
}

export function dueSoonWithinWindow(
  dueMonth: PlaketteMonth,
  today: Date,
  windowDays: PickerlWindowDays,
): boolean {
  const windowEnd = pickerlWindowEndDate(today, windowDays);
  return VehiclePickerlQueryBuilder.isWithinWindow(
    { status: 'DUE_SOON', due_month: formatYearMonth(dueMonth) },
    { window: windowDays },
    windowEnd,
  );
}
