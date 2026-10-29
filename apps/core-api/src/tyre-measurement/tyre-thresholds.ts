const DEFAULT_THRESHOLDS = {
  AT_SUMMER_LIGHT: {
    legalMinimumMm: 1.6,
    recommendedBelowMm: 3,
    ordinaryMinimumMm: 1.6,
  },
  AT_SUMMER_HEAVY: {
    legalMinimumMm: 2,
    recommendedBelowMm: 3,
    ordinaryMinimumMm: 2,
  },
  AT_WINTER_LIGHT_RADIAL: {
    legalMinimumMm: 4,
    recommendedBelowMm: 5,
    ordinaryMinimumMm: 1.6,
  },
  AT_WINTER_LIGHT_DIAGONAL: {
    legalMinimumMm: 5,
    recommendedBelowMm: 6,
    ordinaryMinimumMm: 1.6,
  },
  AT_WINTER_HEAVY_RADIAL: {
    legalMinimumMm: 5,
    recommendedBelowMm: 6,
    ordinaryMinimumMm: 2,
  },
  AT_WINTER_HEAVY_DIAGONAL: {
    legalMinimumMm: 6,
    recommendedBelowMm: 7,
    ordinaryMinimumMm: 2,
  },
  DE_SUMMER: {
    legalMinimumMm: 1.6,
    recommendedBelowMm: 3,
    ordinaryMinimumMm: 1.6,
  },
  DE_WINTER: {
    legalMinimumMm: 1.6,
    recommendedBelowMm: 4,
    ordinaryMinimumMm: 1.6,
  },
} as const;

export type TyreThresholdProfile = keyof typeof DEFAULT_THRESHOLDS;
export type TyreThresholdOverrides = Partial<
  Record<TyreThresholdProfile, { recommendedBelowMm: number }>
>;
export type TyreThresholds = {
  legalMinimumMm: number;
  recommendedBelowMm: number;
  ordinaryMinimumMm: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProfile(value: string): value is TyreThresholdProfile {
  return Object.hasOwn(DEFAULT_THRESHOLDS, value);
}

export function validateTyreThresholdOverrides(
  input: unknown,
): TyreThresholdOverrides {
  if (!isRecord(input)) throw new Error('TYRE_THRESHOLDS_INVALID');
  const result: TyreThresholdOverrides = {};
  for (const [profile, override] of Object.entries(input)) {
    if (!isProfile(profile) || !isRecord(override))
      throw new Error('TYRE_THRESHOLDS_INVALID');
    const minimum = DEFAULT_THRESHOLDS[profile];
    const amber = override.recommendedBelowMm;
    if (
      Object.keys(override).some(
        (key) => key !== 'recommendedBelowMm' && key !== 'legalMinimumMm',
      ) ||
      (override.legalMinimumMm !== undefined &&
        override.legalMinimumMm !== minimum.legalMinimumMm) ||
      typeof amber !== 'number' ||
      !Number.isFinite(amber) ||
      amber < minimum.recommendedBelowMm ||
      amber > 20
    )
      throw new Error('TYRE_THRESHOLDS_INVALID');
    result[profile] = { recommendedBelowMm: amber };
  }
  return result;
}

export function resolveTyreThresholds(
  profile: TyreThresholdProfile,
  overrides: TyreThresholdOverrides = {},
): TyreThresholds {
  const validated = validateTyreThresholdOverrides(overrides);
  return { ...DEFAULT_THRESHOLDS[profile], ...validated[profile] };
}
