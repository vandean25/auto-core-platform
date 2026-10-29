import { describe, expect, it } from '@jest/globals';
import { captureTyreWheel } from './tyre-measurement-capture.js';

const wheel = {
  position: 'FL' as const,
  treadInnerMm: 1,
  treadMiddleMm: 2,
  treadOuterMm: 3,
  season: 'SUMMER' as const,
  dot: '239',
};
const context = {
  country: 'ES',
  weightClass: 'UP_TO_3500_KG' as const,
  asOf: new Date('2026-10-29T12:00:00Z'),
};

describe('captureTyreWheel', () => {
  it('persists raw facts and unsupported evaluation without an Austrian fallback', () => {
    expect(captureTyreWheel(wheel, context)).toMatchObject({
      position: 'FL',
      tread_inner_mm: 1,
      tread_middle_mm: 2,
      tread_outer_mm: 3,
      dot: '239',
      season: 'SUMMER',
      construction: 'RADIAL',
      winter_marking: 'NONE',
      evaluation: {
        country: 'ES',
        state: 'UNSUPPORTED_COUNTRY',
        status: null,
        thresholds: null,
        reasonCodes: ['UNSUPPORTED_COUNTRY'],
        dot: { productionYear: null, ageMonths: null },
      },
    });
  });

  it('maps malformed DOT to a client error rather than an internal error', () => {
    expect(() => captureTyreWheel({ ...wheel, dot: '0020' }, context)).toThrow(
      expect.objectContaining({
        response: { code: 'TYRE_DOT_INVALID_WEEK' },
        status: 400,
      }),
    );
  });
});
