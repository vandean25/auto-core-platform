export type PickerlRuleSetId =
  | 'm1-legacy-pre-2027'
  | 'm1-kfg42-from-2027-05-19';

export type PickerlTolerance = {
  monthsBefore: number;
  monthsAfter: number;
};

export type PickerlRuleSet = {
  id: PickerlRuleSetId;
  validFrom: string;
  label: string;
  /** Years between inspections; last entry repeats for subsequent cycles. */
  intervalYears: readonly number[];
  tolerance: PickerlTolerance;
  sourceUrl: string;
  retrievedOn: string;
};

export const KFG42_EFFECTIVE_DATE = '2027-05-19';

export const PICKERL_RULE_SETS: readonly PickerlRuleSet[] = [
  {
    id: 'm1-legacy-pre-2027',
    validFrom: '1970-01-01',
    label: 'M1 legacy 3-2-1-1…',
    intervalYears: [3, 2, 1],
    tolerance: { monthsBefore: 1, monthsAfter: 4 },
    sourceUrl:
      'https://www.wko.at/transport/pickerl-ueberpruefung-begutachtung-57a-kfg',
    retrievedOn: '2026-10-02',
  },
  {
    id: 'm1-kfg42-from-2027-05-19',
    validFrom: KFG42_EFFECTIVE_DATE,
    label: 'M1 KFG 42 (4-2-2-2-1)',
    intervalYears: [4, 2, 2, 2, 1],
    tolerance: { monthsBefore: 4, monthsAfter: 0 },
    sourceUrl: 'https://www.wko.at/paragraph-57a/begutachtungstermine',
    retrievedOn: '2026-10-02',
  },
];

export function resolvePickerlRuleSet(
  onDate: Date,
  ruleSetVersion?: PickerlRuleSetId | null,
): PickerlRuleSet {
  if (ruleSetVersion) {
    const forced = PICKERL_RULE_SETS.find((set) => set.id === ruleSetVersion);
    if (!forced) {
      throw new Error(`Unknown Pickerl rule set version: ${ruleSetVersion}`);
    }
    return forced;
  }

  const onDay = toUtcDateString(onDate);
  let selected = PICKERL_RULE_SETS[0];
  for (const candidate of PICKERL_RULE_SETS) {
    if (onDay >= candidate.validFrom) {
      selected = candidate;
    }
  }
  return selected;
}

function toUtcDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function intervalYearsAtIndex(
  ruleSet: PickerlRuleSet,
  inspectionIndex: number,
): number {
  const intervals = ruleSet.intervalYears;
  if (inspectionIndex < intervals.length) {
    return intervals[inspectionIndex];
  }
  return intervals[intervals.length - 1] ?? 1;
}
