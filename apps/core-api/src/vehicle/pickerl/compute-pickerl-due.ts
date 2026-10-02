import {
  addMonths,
  addYears,
  compareUtcDates,
  endOfMonthUtc,
  formatYearMonth,
  startOfMonthUtc,
  toYearMonthFromDate,
  type YearMonth,
} from './pickerl-date.util.js';
import {
  intervalYearsAtIndex,
  KFG42_EFFECTIVE_DATE,
  resolvePickerlRuleSet,
  type PickerlRuleSet,
  type PickerlRuleSetId,
} from './pickerl-rule-sets.js';

export type PickerlDueStatus = 'OK' | 'DUE_SOON' | 'OVERDUE' | 'UNKNOWN';

export type PickerlWarning = {
  code: string;
  message: string;
};

export type PickerlInspectionRecordInput = {
  inspected_on: Date | string;
  plaketten_valid_until_year: number;
  plaketten_valid_until_month: number;
};

export type PickerlVehicleInput = {
  first_registration_date?: Date | string | null;
};

export type PickerlDueResult = {
  due_month: string | null;
  status: PickerlDueStatus;
  rule_id: PickerlRuleSetId;
  warnings: PickerlWarning[];
};

type ResolvedTolerance = PickerlRuleSet['tolerance'] & {
  lateEndCap?: Date;
};

const TRANSITION_2027_LATE_END_CAP = endOfMonthUtc({ year: 2027, month: 11 });

const ASSUMED_M1_WARNING: PickerlWarning = {
  code: 'VEHICLE_CLASS_ASSUMED_M1',
  message:
    'Vehicle class is not stored; §57a computation assumes ordinary M1 (Pkw) intervals.',
};

const WKO_GUIDANCE_WARNING: PickerlWarning = {
  code: 'WKO_GUIDANCE_NOT_RIS_VERIFIED',
  message:
    'Interval and tolerance tables follow WKO guidance pages; they are not individually cross-checked against RIS §57a in this engine.',
};

const NO_INSPECTION_RECORDS_WARNING: PickerlWarning = {
  code: 'NO_INSPECTION_RECORDS',
  message: 'Keine Begutachtung erfasst — bitte letzte Plakette erfassen.',
};

function toDate(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function sortRecords(
  records: PickerlInspectionRecordInput[],
): PickerlInspectionRecordInput[] {
  return [...records].sort(
    (left, right) =>
      toDate(left.inspected_on).getTime() -
      toDate(right.inspected_on).getTime(),
  );
}

function recordDueMonth(record: PickerlInspectionRecordInput): YearMonth {
  return {
    year: record.plaketten_valid_until_year,
    month: record.plaketten_valid_until_month,
  };
}

function computeDueFromFirstRegistration(
  firstRegistration: Date,
  ruleSet: PickerlRuleSet,
  completedInspectionCount: number,
): YearMonth {
  const anchor = toYearMonthFromDate(firstRegistration);
  const years = intervalYearsAtIndex(ruleSet, completedInspectionCount);
  return addYears(anchor, years);
}

function computeDueAfterInspection(
  firstRegistration: Date,
  records: PickerlInspectionRecordInput[],
  ruleSet: PickerlRuleSet,
): YearMonth {
  const latest = records[records.length - 1];
  if (latest) {
    return recordDueMonth(latest);
  }
  return computeDueFromFirstRegistration(firstRegistration, ruleSet, 0);
}

function usesTransition2027Tolerance(dueMonth: YearMonth): boolean {
  return dueMonth.year === 2027 && dueMonth.month >= 1 && dueMonth.month <= 10;
}

function resolveTolerance(
  ruleSet: PickerlRuleSet,
  dueMonth: YearMonth,
  warnings: PickerlWarning[],
): ResolvedTolerance {
  if (usesTransition2027Tolerance(dueMonth)) {
    warnings.push({
      code: 'TRANSITION_2027_TOLERANCE',
      message:
        '2027 transition: legacy −1/+4 tolerance with late end capped at November 2027 (WKO §132 Abs 37 Z 3; WKO-sourced, not RIS-verified in engine).',
    });
    return {
      monthsBefore: 1,
      monthsAfter: 4,
      lateEndCap: TRANSITION_2027_LATE_END_CAP,
    };
  }
  return ruleSet.tolerance;
}

function computeStatus(
  onDate: Date,
  dueMonth: YearMonth,
  tolerance: ResolvedTolerance,
): PickerlDueStatus {
  const earlyStart = startOfMonthUtc(
    addMonths(dueMonth, -tolerance.monthsBefore),
  );
  let lateEnd = endOfMonthUtc(addMonths(dueMonth, tolerance.monthsAfter));
  if (
    tolerance.lateEndCap &&
    compareUtcDates(lateEnd, tolerance.lateEndCap) > 0
  ) {
    lateEnd = tolerance.lateEndCap;
  }

  if (compareUtcDates(onDate, earlyStart) < 0) {
    return 'OK';
  }
  if (compareUtcDates(onDate, lateEnd) > 0) {
    return 'OVERDUE';
  }
  return 'DUE_SOON';
}

function computeAustauschplaketteMonth(
  firstRegistration: Date,
  records: PickerlInspectionRecordInput[],
): YearMonth {
  if (records.length === 0) {
    return addYears(toYearMonthFromDate(firstRegistration), 4);
  }
  const latest = records[records.length - 1];
  if (!latest) {
    return addYears(toYearMonthFromDate(firstRegistration), 4);
  }
  return addYears(toYearMonthFromDate(toDate(latest.inspected_on)), 2);
}

function buildAustauschWarning(
  firstRegistration: Date,
  records: PickerlInspectionRecordInput[],
): PickerlWarning {
  const austauschMonth = formatYearMonth(
    computeAustauschplaketteMonth(firstRegistration, records),
  );
  return {
    code: 'AUSTAUSCHPLAKETTE_NOT_TRACKED',
    message: `Austauschplakette punching hint: ${austauschMonth} (WKO §4; WKO-sourced, not RIS-verified; issuance not tracked in ACP).`,
  };
}

export function computePickerlDue(
  vehicle: PickerlVehicleInput,
  records: PickerlInspectionRecordInput[],
  onDate: Date,
  ruleSetVersion?: PickerlRuleSetId | null,
): PickerlDueResult {
  const warnings: PickerlWarning[] = [ASSUMED_M1_WARNING, WKO_GUIDANCE_WARNING];

  if (!vehicle.first_registration_date) {
    return {
      due_month: null,
      status: 'UNKNOWN',
      rule_id: resolvePickerlRuleSet(onDate, ruleSetVersion).id,
      warnings,
    };
  }

  const ruleSet = resolvePickerlRuleSet(onDate, ruleSetVersion);
  const firstRegistration = toDate(vehicle.first_registration_date);
  const orderedRecords = sortRecords(records);

  if (onDate >= new Date(`${KFG42_EFFECTIVE_DATE}T00:00:00.000Z`)) {
    warnings.push(buildAustauschWarning(firstRegistration, orderedRecords));
  }

  const dueMonth = orderedRecords.length
    ? computeDueAfterInspection(firstRegistration, orderedRecords, ruleSet)
    : computeDueFromFirstRegistration(firstRegistration, ruleSet, 0);

  const tolerance = resolveTolerance(ruleSet, dueMonth, warnings);
  const status = computeStatus(onDate, dueMonth, tolerance);

  if (orderedRecords.length === 0 && status === 'OVERDUE') {
    warnings.push(NO_INSPECTION_RECORDS_WARNING);
    return {
      due_month: null,
      status: 'UNKNOWN',
      rule_id: ruleSet.id,
      warnings,
    };
  }

  return {
    due_month: formatYearMonth(dueMonth),
    status,
    rule_id: ruleSet.id,
    warnings,
  };
}
