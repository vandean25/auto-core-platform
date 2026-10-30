import { evaluateTyreWheel } from './tyre-evaluation.js';
import type {
  TyreEvaluationContext,
  TyreWheelInput,
} from './tyre-evaluation.js';

const wheel: TyreWheelInput = {
  treadInnerMm: 8,
  treadMiddleMm: 8,
  treadOuterMm: 8,
  season: 'SUMMER',
  construction: 'RADIAL',
  winterMarking: 'ALPINE',
};
const context: TyreEvaluationContext = {
  country: 'AT',
  weightClass: 'UP_TO_3500_KG',
  asOf: new Date('2026-10-29T00:00:00Z'),
};

const cases = [
  ['AT', 'SUMMER', 'RADIAL', 'UP_TO_3500_KG', 1.6, 3],
  ['AT', 'SUMMER', 'RADIAL', 'OVER_3500_KG', 2, 3],
  ['AT', 'WINTER', 'RADIAL', 'UP_TO_3500_KG', 4, 5],
  ['AT', 'WINTER', 'DIAGONAL', 'UP_TO_3500_KG', 5, 6],
  ['AT', 'WINTER', 'RADIAL', 'OVER_3500_KG', 5, 6],
  ['AT', 'WINTER', 'DIAGONAL', 'OVER_3500_KG', 6, 7],
  ['DE', 'SUMMER', 'DIAGONAL', 'OVER_3500_KG', 1.6, 3],
  ['DE', 'WINTER', 'RADIAL', 'UP_TO_3500_KG', 1.6, 4],
] as const;

describe('evaluateTyreWheel', () => {
  it.each(cases)(
    '%s %s %s %s: red=%s amber=%s',
    (country, season, construction, weightClass, red, amber) => {
      const evaluate = (depth: number) =>
        evaluateTyreWheel(
          { ...wheel, season, construction, treadMiddleMm: depth },
          { ...context, country, weightClass },
        ).status;
      expect([
        evaluate(red - 0.01),
        evaluate(red),
        evaluate(amber - 0.01),
        evaluate(amber),
      ]).toEqual(['URGENT', 'RECOMMENDED', 'RECOMMENDED', 'GOOD']);
    },
  );
  it.each(['treadInnerMm', 'treadMiddleMm', 'treadOuterMm'] as const)(
    'uses the worst point: %s',
    (point) => {
      expect(
        evaluateTyreWheel({ ...wheel, [point]: 1.5 }, context).status,
      ).toBe('URGENT');
    },
  );
  it('evaluates all-season as winter regardless of the calendar month', () => {
    expect(
      evaluateTyreWheel(
        { ...wheel, season: 'ALL_SEASON', treadInnerMm: 3.9 },
        { ...context, asOf: new Date('2026-07-01') },
      ).reasonCodes,
    ).toContain('AT_WINTER_TREAD_INSUFFICIENT');
  });
  it('uses the ordinary illegal-tread reason below the absolute AT minimum', () => {
    expect(
      evaluateTyreWheel(
        { ...wheel, season: 'WINTER', treadInnerMm: 1.5 },
        context,
      ).reasonCodes,
    ).toEqual(['TREAD_BELOW_LEGAL_MINIMUM']);
  });
  it('marks German M+S-only winter tyres urgent regardless of tread depth', () => {
    expect(
      evaluateTyreWheel(
        { ...wheel, season: 'WINTER', winterMarking: 'M_S' },
        { ...context, country: 'DE' },
      ),
    ).toMatchObject({ status: 'URGENT', reasonCodes: ['DE_ALPINE_MISSING'] });
  });
  it.each(['NONE', 'ALPINE'] as const)(
    'does not flag the German marking %s',
    (winterMarking) => {
      expect(
        evaluateTyreWheel(
          { ...wheel, season: 'WINTER', winterMarking },
          { ...context, country: 'DE' },
        ).status,
      ).toBe('GOOD');
    },
  );
  it('does not require Alpine in Austria', () => {
    expect(
      evaluateTyreWheel(
        { ...wheel, season: 'WINTER', winterMarking: 'M_S' },
        context,
      ).status,
    ).toBe('GOOD');
  });
  it('adds the Austrian informational warning to German winter tread below 4mm', () => {
    expect(
      evaluateTyreWheel(
        { ...wheel, season: 'WINTER', treadInnerMm: 3.9 },
        { ...context, country: 'DE' },
      ).reasonCodes,
    ).toContain('AT_WINTER_RULE_NOTICE');
  });
  it.each([
    ['WINTER', '4418', '2026-10-28', 'GOOD'],
    ['WINTER', '4418', '2026-10-29', 'RECOMMENDED'],
    ['SUMMER', '4416', '2026-10-30', 'GOOD'],
    ['SUMMER', '4416', '2026-10-31', 'RECOMMENDED'],
    ['ALL_SEASON', '4418', '2026-10-29', 'RECOMMENDED'],
  ] as const)(
    'age threshold for %s DOT %s at %s',
    (season, dot, date, status) => {
      expect(
        evaluateTyreWheel(
          { ...wheel, season, dot },
          { ...context, asOf: new Date(date) },
        ).status,
      ).toBe(status);
    },
  );
  it('adds a six-year information reason without changing colour', () => {
    expect(evaluateTyreWheel({ ...wheel, dot: '4320' }, context)).toMatchObject(
      { status: 'GOOD', reasonCodes: ['DOT_CONDITION_CHECK_RECOMMENDED'] },
    );
  });
  it('never turns red from legacy age alone', () => {
    expect(evaluateTyreWheel({ ...wheel, dot: '239' }, context)).toMatchObject({
      status: 'RECOMMENDED',
      dot: { ageMonths: null },
      reasonCodes: expect.arrayContaining([
        'DOT_LEGACY_OVER_20_YEARS',
        'DOT_REPLACEMENT_RECOMMENDED',
      ]),
    });
  });
  it('saves facts without a traffic-light status for an unsupported country', () => {
    expect(
      evaluateTyreWheel(
        { ...wheel, treadInnerMm: 0, dot: '239' },
        { ...context, country: 'ES' },
      ),
    ).toMatchObject({
      state: 'UNSUPPORTED_COUNTRY',
      status: null,
      thresholds: null,
      reasonCodes: ['UNSUPPORTED_COUNTRY'],
      minimumTreadMm: 0,
      dot: { format: 'LEGACY_PRE_2000' },
    });
  });
  it('includes the exact evaluation inputs and thresholds in the snapshot', () => {
    expect(evaluateTyreWheel(wheel, context)).toMatchObject({
      version: 1,
      rulesVersion: 'AT_DE_2026_10',
      country: 'AT',
      evaluatedAt: '2026-10-29T00:00:00.000Z',
      weightClass: 'UP_TO_3500_KG',
      thresholds: { legalMinimumMm: 1.6, recommendedBelowMm: 3 },
    });
  });
  it.each([-1, NaN, Infinity, 21])('rejects invalid tread %s', (depth) => {
    expect(() =>
      evaluateTyreWheel({ ...wheel, treadInnerMm: depth }, context),
    ).toThrow('TYRE_TREAD_INVALID');
  });
});
