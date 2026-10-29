import { parseTyreDot } from './tyre-dot.js';

const asOf = new Date('2026-10-29T12:00:00Z');

describe('parseTyreDot', () => {
  it('reads a modern suffix and completed calendar months in UTC', () => {
    expect(parseTyreDot(' DOT ABC 4320 ', asOf)).toEqual({
      format: 'MODERN',
      productionWeek: 43,
      productionYear: 2020,
      productionDate: '2020-10-19',
      ageMonths: 72,
      minimumAgeMonths: 72,
    });
  });
  it('uses the ISO week year across the calendar year boundary', () => {
    expect(parseTyreDot('0120', asOf).productionDate).toBe('2019-12-30');
  });
  it('accepts week 53 in a year that contains it', () => {
    expect(parseTyreDot('5320', asOf).productionDate).toBe('2020-12-28');
  });
  it.each(['0020', '5420', '5321'])('rejects invalid week %s', (dot) => {
    expect(() => parseTyreDot(dot, asOf)).toThrow('TYRE_DOT_INVALID_WEEK');
  });
  it.each(['', '12', 'DOT AB XXYY'])(
    'rejects malformed or short code %s',
    (dot) => {
      expect(() => parseTyreDot(dot, asOf)).toThrow('TYRE_DOT_INVALID_FORMAT');
    },
  );
  it.each(['0127', '4599', '4526'])('rejects future production %s', (dot) => {
    expect(() => parseTyreDot(dot, asOf)).toThrow('TYRE_DOT_FUTURE_DATE');
  });
  it('accepts the current production week', () => {
    expect(parseTyreDot('4426', asOf).ageMonths).toBe(0);
  });
  it.each([
    ['2026-10-18T23:59:59Z', 71],
    ['2026-10-19T00:00:00Z', 72],
  ])('counts completed months at %s', (date, expected) => {
    expect(parseTyreDot('4320', new Date(date)).ageMonths).toBe(expected);
  });
  it('preserves a legacy code without inventing its decade or exact age', () => {
    expect(parseTyreDot('DOT ABC 239', asOf)).toEqual({
      format: 'LEGACY_PRE_2000',
      productionWeek: 23,
      productionYear: null,
      productionDate: null,
      ageMonths: null,
      minimumAgeMonths: 321,
    });
  });
  it.each(['009', '549'])('rejects invalid legacy week %s', (dot) => {
    expect(() => parseTyreDot(dot, asOf)).toThrow('TYRE_DOT_INVALID_WEEK');
  });
  it('rejects an invalid evaluation date', () => {
    expect(() => parseTyreDot('4320', new Date('invalid'))).toThrow(
      'TYRE_EVALUATION_DATE_INVALID',
    );
  });
});
