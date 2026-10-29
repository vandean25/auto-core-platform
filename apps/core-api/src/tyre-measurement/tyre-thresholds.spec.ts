import { validateTyreThresholdOverrides } from './tyre-thresholds.js';
import { evaluateTyreWheel } from './tyre-evaluation.js';

describe('tyre recommendation overrides', () => {
  it('accepts increasing the recommendation without changing the legal floor', () => {
    const overrides = validateTyreThresholdOverrides({
      AT_SUMMER_LIGHT: { recommendedBelowMm: 4 },
    });
    expect(
      evaluateTyreWheel(
        {
          treadInnerMm: 3.5,
          treadMiddleMm: 5,
          treadOuterMm: 5,
          season: 'SUMMER',
        },
        {
          country: 'AT',
          weightClass: 'UP_TO_3500_KG',
          asOf: new Date('2026-10-29'),
          overrides,
        },
      ),
    ).toMatchObject({
      status: 'RECOMMENDED',
      thresholds: { legalMinimumMm: 1.6, recommendedBelowMm: 4 },
    });
  });
  it.each([
    { AT_SUMMER_LIGHT: { recommendedBelowMm: 2 } },
    { AT_SUMMER_LIGHT: { legalMinimumMm: 1.5, recommendedBelowMm: 4 } },
    { AT_SUMMER_LIGHT: { legalMinimumMm: 2, recommendedBelowMm: 4 } },
    { AT_WINTER_HEAVY_DIAGONAL: { recommendedBelowMm: 6 } },
    { ES_SUMMER: { recommendedBelowMm: 4 } },
    { AT_SUMMER_LIGHT: { recommendedBelowMm: Infinity } },
    { AT_SUMMER_LIGHT: { recommendedBelowMm: 21 } },
    { AT_SUMMER_LIGHT: { recommendedBelowMm: '4' } },
    { AT_SUMMER_LIGHT: { recommendedBelowMm: 4, redMm: 0 } },
    [],
    null,
  ])('rejects invalid override %j', (input) => {
    expect(() => validateTyreThresholdOverrides(input)).toThrow(
      'TYRE_THRESHOLDS_INVALID',
    );
  });
  it('accepts an empty collection to restore defaults', () => {
    expect(validateTyreThresholdOverrides({})).toEqual({});
  });
});
