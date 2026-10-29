import { parseLegacyTreadJson } from './tyre-measurement-backfill.js';
import { worstTyreStatus } from './tyre-evaluation.js';

describe('parseLegacyTreadJson', () => {
  it('reads per-position numbers and the spare wheel', () => {
    expect(parseLegacyTreadJson({ FL: 4.5, FR: 5, RL: 3, RR: 3, SPARE: 6 }))
      .toEqual({
        readings: [
          { position: 'FL', mm: 4.5 },
          { position: 'FR', mm: 5 },
          { position: 'RL', mm: 3 },
          { position: 'RR', mm: 3 },
          { position: 'SPARE', mm: 6 },
        ],
        warnings: [],
      });
  });

  it('accepts lower-case position keys and duplicate spellings once', () => {
    const parsed = parseLegacyTreadJson({ fl: 4, FL: 5, rR: 3 });
    expect(parsed.readings).toEqual([
      { position: 'FL', mm: 4 },
      { position: 'RR', mm: 3 },
    ]);
    expect(parsed.warnings).toEqual([
      { reason: 'DUPLICATE_POSITION', key: 'FL' },
    ]);
  });

  it('counts missing, non-numeric, out-of-range and unknown keys', () => {
    const parsed = parseLegacyTreadJson({
      FL: 'tread',
      FR: null,
      RL: 20.5,
      RR: -1,
      SPARE: Number.NaN,
      EXTRA: 7,
    });
    expect(parsed.readings).toEqual([]);
    expect(parsed.warnings.map((warning) => warning.reason)).toEqual([
      'INVALID_VALUE',
      'INVALID_VALUE',
      'INVALID_VALUE',
      'INVALID_VALUE',
      'INVALID_VALUE',
      'INVALID_KEY',
    ]);
  });

  it('rejects values with more than hundredth precision', () => {
    expect(parseLegacyTreadJson({ FL: 3.999, FR: 4 })).toEqual({
      readings: [{ position: 'FR', mm: 4 }],
      warnings: [{ reason: 'INVALID_VALUE', key: 'FL' }],
    });
  });

  it('rejects values that are not a plain object', () => {
    expect(parseLegacyTreadJson(null)).toEqual({
      readings: [],
      warnings: [],
    });
    expect(parseLegacyTreadJson([4, 5])).toEqual({
      readings: [],
      warnings: [{ reason: 'NOT_AN_OBJECT' }],
    });
    expect(parseLegacyTreadJson('FL=4')).toEqual({
      readings: [],
      warnings: [{ reason: 'NOT_AN_OBJECT' }],
    });
  });
});

describe('worstTyreStatus', () => {
  it('returns the most severe evaluated status and ignores unsupported wheels', () => {
    expect(worstTyreStatus(['GOOD', 'RECOMMENDED', 'URGENT'])).toBe('URGENT');
    expect(worstTyreStatus(['GOOD', 'RECOMMENDED'])).toBe('RECOMMENDED');
    expect(worstTyreStatus([null, 'GOOD'])).toBe('GOOD');
    expect(worstTyreStatus([null, undefined])).toBeNull();
    expect(worstTyreStatus([])).toBeNull();
  });
});
