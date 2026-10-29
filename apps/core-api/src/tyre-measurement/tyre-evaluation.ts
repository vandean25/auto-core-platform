import { parseTyreDot } from './tyre-dot.js';
import type { TyreDot } from './tyre-dot.js';
import { resolveTyreThresholds } from './tyre-thresholds.js';
import type {
  TyreThresholdOverrides,
  TyreThresholdProfile,
  TyreThresholds,
} from './tyre-thresholds.js';

export type TyreWeightClass = 'UP_TO_3500_KG' | 'OVER_3500_KG';
export type TyreStatus = 'GOOD' | 'RECOMMENDED' | 'URGENT';
export type TyreReasonCode =
  | 'TREAD_BELOW_LEGAL_MINIMUM'
  | 'AT_WINTER_TREAD_INSUFFICIENT'
  | 'TREAD_REPLACEMENT_RECOMMENDED'
  | 'DE_ALPINE_MISSING'
  | 'AT_WINTER_RULE_NOTICE'
  | 'DOT_CONDITION_CHECK_RECOMMENDED'
  | 'DOT_REPLACEMENT_RECOMMENDED'
  | 'DOT_LEGACY_OVER_20_YEARS'
  | 'UNSUPPORTED_COUNTRY';
export type TyreWheelInput = {
  treadInnerMm: number;
  treadMiddleMm: number;
  treadOuterMm: number;
  season: 'SUMMER' | 'WINTER' | 'ALL_SEASON';
  construction?: 'RADIAL' | 'DIAGONAL';
  winterMarking?: 'NONE' | 'M_S' | 'ALPINE';
  dot?: string | null;
};
export type TyreEvaluationContext = {
  country: string;
  weightClass: TyreWeightClass;
  asOf: Date;
  overrides?: TyreThresholdOverrides;
};
export type TyreEvaluation = {
  version: 1;
  rulesVersion: 'AT_DE_2026_10';
  country: string;
  evaluatedAt: string;
  weightClass: TyreWeightClass;
  state: 'EVALUATED' | 'UNSUPPORTED_COUNTRY';
  status: TyreStatus | null;
  reasonCodes: TyreReasonCode[];
  minimumTreadMm: number;
  thresholds: TyreThresholds | null;
  dot: TyreDot | null;
};

const AGE_INFO_MONTHS = 72;
const WINTER_REPLACEMENT_MONTHS = 96;
const SUMMER_REPLACEMENT_MONTHS = 120;
const TWENTY_YEARS_MONTHS = 240;

const STATUS_SEVERITY: Record<TyreStatus, number> = {
  GOOD: 1,
  RECOMMENDED: 2,
  URGENT: 3,
};

/** Worst evaluated status across wheels; unsupported-country wheels do not contribute. */
export function worstTyreStatus(
  statuses: Array<TyreStatus | null | undefined>,
): TyreStatus | null {
  let worst: TyreStatus | null = null;
  for (const status of statuses) {
    if (!status) continue;
    if (!worst || STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) {
      worst = status;
    }
  }
  return worst;
}

function thresholdProfile(
  wheel: TyreWheelInput,
  context: TyreEvaluationContext,
): TyreThresholdProfile {
  const season = wheel.season === 'SUMMER' ? 'SUMMER' : 'WINTER';
  if (context.country === 'DE') return `DE_${season}`;
  const weight = context.weightClass === 'OVER_3500_KG' ? 'HEAVY' : 'LIGHT';
  return season === 'SUMMER'
    ? `AT_SUMMER_${weight}`
    : `AT_WINTER_${weight}_${wheel.construction ?? 'RADIAL'}`;
}

function evaluateTread(
  minimum: number,
  thresholds: TyreThresholds,
): { status: TyreStatus; reasonCodes: TyreReasonCode[] } {
  if (minimum < thresholds.ordinaryMinimumMm) {
    return { status: 'URGENT', reasonCodes: ['TREAD_BELOW_LEGAL_MINIMUM'] };
  }
  if (minimum < thresholds.legalMinimumMm) {
    return { status: 'URGENT', reasonCodes: ['AT_WINTER_TREAD_INSUFFICIENT'] };
  }
  if (minimum < thresholds.recommendedBelowMm) {
    return {
      status: 'RECOMMENDED',
      reasonCodes: ['TREAD_REPLACEMENT_RECOMMENDED'],
    };
  }
  return { status: 'GOOD', reasonCodes: [] };
}

function evaluateAge(
  dot: TyreDot | null,
  season: TyreWheelInput['season'],
): { status: TyreStatus; reasonCodes: TyreReasonCode[] } {
  const reasonCodes: TyreReasonCode[] = [];
  if (!dot) return { status: 'GOOD', reasonCodes };
  const months = dot.minimumAgeMonths;
  if (months >= AGE_INFO_MONTHS)
    reasonCodes.push('DOT_CONDITION_CHECK_RECOMMENDED');
  if (dot.format === 'LEGACY_PRE_2000' && months >= TWENTY_YEARS_MONTHS)
    reasonCodes.push('DOT_LEGACY_OVER_20_YEARS');
  const limit =
    season === 'SUMMER' ? SUMMER_REPLACEMENT_MONTHS : WINTER_REPLACEMENT_MONTHS;
  if (months >= limit) {
    reasonCodes.push('DOT_REPLACEMENT_RECOMMENDED');
    return { status: 'RECOMMENDED', reasonCodes };
  }
  return { status: 'GOOD', reasonCodes };
}

export function evaluateTyreWheel(
  wheel: TyreWheelInput,
  context: TyreEvaluationContext,
): TyreEvaluation {
  const points = [wheel.treadInnerMm, wheel.treadMiddleMm, wheel.treadOuterMm];
  if (
    points.some((point) => !Number.isFinite(point) || point < 0 || point > 20)
  )
    throw new Error('TYRE_TREAD_INVALID');
  if (!Number.isFinite(context.asOf.getTime()))
    throw new Error('TYRE_EVALUATION_DATE_INVALID');
  const base = {
    version: 1,
    rulesVersion: 'AT_DE_2026_10',
    country: context.country,
    evaluatedAt: context.asOf.toISOString(),
    weightClass: context.weightClass,
    minimumTreadMm: Math.min(...points),
    dot: wheel.dot ? parseTyreDot(wheel.dot, context.asOf) : null,
  } as const;
  if (context.country !== 'AT' && context.country !== 'DE') {
    return {
      ...base,
      state: 'UNSUPPORTED_COUNTRY',
      status: null,
      reasonCodes: ['UNSUPPORTED_COUNTRY'],
      thresholds: null,
    };
  }
  const thresholds = resolveTyreThresholds(
    thresholdProfile(wheel, context),
    context.overrides,
  );
  const tread = evaluateTread(base.minimumTreadMm, thresholds);
  const age = evaluateAge(base.dot, wheel.season);
  const reasons = [...tread.reasonCodes, ...age.reasonCodes];
  const missingAlpine =
    context.country === 'DE' &&
    wheel.season !== 'SUMMER' &&
    wheel.winterMarking === 'M_S';
  if (missingAlpine) reasons.push('DE_ALPINE_MISSING');
  if (
    context.country === 'DE' &&
    wheel.season !== 'SUMMER' &&
    base.minimumTreadMm >= 1.6 &&
    base.minimumTreadMm < 4
  )
    reasons.push('AT_WINTER_RULE_NOTICE');
  const status =
    tread.status === 'URGENT' || missingAlpine
      ? 'URGENT'
      : tread.status === 'RECOMMENDED' || age.status === 'RECOMMENDED'
        ? 'RECOMMENDED'
        : 'GOOD';
  return {
    ...base,
    state: 'EVALUATED',
    status,
    reasonCodes: reasons,
    thresholds,
  };
}
