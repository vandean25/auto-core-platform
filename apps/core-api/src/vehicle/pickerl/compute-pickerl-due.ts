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

const ASSUMED_M1_WARNING: PickerlWarning = {
  code: 'VEHICLE_CLASS_ASSUMED_M1',
  message:
    'Vehicle class is not stored; §57a computation assumes ordinary M1 (Pkw) intervals.',
};

const AUSTAUSCH_WARNING: PickerlWarning = {
  code: 'AUSTAUSCHPLAKETTE_NOT_TRACKED',
  message:
    'Austauschplakette (replacement sticker) workflow is not modeled; verify due month manually after KFG 42 transition.',
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
      toDate(left.inspected_on).getTime() - toDate(right.inspected_on).getTime(),
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

function resolveTolerance(
  ruleSet: PickerlRuleSet,
  dueMonth: YearMonth,
  onDate: Date,
  warnings: PickerlWarning[],
): PickerlRuleSet['tolerance'] {
  if (
    ruleSet.id === 'm1-kfg42-from-2027-05-19' &&
    onDate.getUTCFullYear() === 2027 &&
    dueMonth.year === 2027 &&
    dueMonth.month >= 1 &&
    dueMonth.month <= 10
  ) {
    warnings.push({
      code: 'TRANSITION_2027_TOLERANCE',
      message:
        '2027 transition tolerance for legacy plaketten is simplified; confirm against WKO Begutachtungstermine.',
    });
    return { monthsBefore: 1, monthsAfter: 4 };
  }
  return ruleSet.tolerance;
}

function computeStatus(
  onDate: Date,
  dueMonth: YearMonth,
  tolerance: PickerlRuleSet['tolerance'],
): PickerlDueStatus {
  const earlyStart = startOfMonthUtc(
    addMonths(dueMonth, -tolerance.monthsBefore),
  );
  const lateEnd = endOfMonthUtc(addMonths(dueMonth, tolerance.monthsAfter));

  if (compareUtcDates(onDate, earlyStart) < 0) {
    return 'OK';
  }
  if (compareUtcDates(onDate, lateEnd) > 0) {
    return 'OVERDUE';
  }
  return 'DUE_SOON';
}

export function computePickerlDue(
  vehicle: PickerlVehicleInput,
  records: PickerlInspectionRecordInput[],
  onDate: Date,
  ruleSetVersion?: PickerlRuleSetId | null,
): PickerlDueResult {
  const warnings: PickerlWarning[] = [ASSUMED_M1_WARNING];

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
    warnings.push(AUSTAUSCH_WARNING);
  }

  const dueMonth = orderedRecords.length
    ? computeDueAfterInspection(firstRegistration, orderedRecords, ruleSet)
    : computeDueFromFirstRegistration(firstRegistration, ruleSet, 0);

  const tolerance = resolveTolerance(ruleSet, dueMonth, onDate, warnings);
  const status = computeStatus(onDate, dueMonth, tolerance);

  return {
    due_month: formatYearMonth(dueMonth),
    status,
    rule_id: ruleSet.id,
    warnings,
  };
}
