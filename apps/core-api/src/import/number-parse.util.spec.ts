import { parseGermanNumber } from './number-parse.util.js';

describe('parseGermanNumber', () => {
  it('parses German numbers with dot as thousand separator and comma as decimal', () => {
    expect(parseGermanNumber('1.234,50')).toBe(1234.5);
    expect(parseGermanNumber('1.234.567,89')).toBe(1234567.89);
  });

  it('parses German numbers with comma as decimal and no thousand separator', () => {
    expect(parseGermanNumber('1234,50')).toBe(1234.5);
    expect(parseGermanNumber('12,5')).toBe(12.5);
    expect(parseGermanNumber('0,99')).toBe(0.99);
  });

  it('parses numbers with dot as decimal separator', () => {
    expect(parseGermanNumber('12.50')).toBe(12.5);
    expect(parseGermanNumber('1234.5')).toBe(1234.5);
  });

  it('parses German numbers with space as thousand separator', () => {
    expect(parseGermanNumber('1 234,50')).toBe(1234.5);
    expect(parseGermanNumber('1\u00A0234,50')).toBe(1234.5); // non-breaking space
    expect(parseGermanNumber('1 234 567,89')).toBe(1234567.89);
  });

  it('parses negative numbers correctly', () => {
    expect(parseGermanNumber('-1.234,50')).toBe(-1234.5);
    expect(parseGermanNumber('-12,5')).toBe(-12.5);
    expect(parseGermanNumber('-12.50')).toBe(-12.5);
    expect(parseGermanNumber('- 12,5')).toBe(-12.5);
  });

  it('handles zero values and whole integers', () => {
    expect(parseGermanNumber('0')).toBe(0);
    expect(parseGermanNumber('0,00')).toBe(0);
    expect(parseGermanNumber('0.00')).toBe(0);
    expect(parseGermanNumber('1500')).toBe(1500);
  });

  it('handles number inputs directly', () => {
    expect(parseGermanNumber(1234.5)).toBe(1234.5);
    expect(parseGermanNumber(0)).toBe(0);
    expect(parseGermanNumber(-42.1)).toBe(-42.1);
  });

  it('returns null for empty, undefined, null, or invalid inputs', () => {
    expect(parseGermanNumber('')).toBeNull();
    expect(parseGermanNumber('   ')).toBeNull();
    expect(parseGermanNumber(undefined)).toBeNull();
    expect(parseGermanNumber(null)).toBeNull();
    expect(parseGermanNumber('abc')).toBeNull();
    expect(parseGermanNumber('12a34')).toBeNull();
    expect(parseGermanNumber('12.34.56')).toBeNull();
    expect(parseGermanNumber(Number.NaN)).toBeNull();
    expect(parseGermanNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
