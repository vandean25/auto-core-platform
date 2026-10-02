import {
  isValidVinCheckDigit,
  isValidVinFormat,
  normalizeVin,
} from './vin.validation.js';

describe('vin.validation', () => {
  it('rejects invalid charset and length', () => {
    expect(isValidVinFormat('SHORT')).toBe(false);
    expect(isValidVinFormat('1HGCM82633A00435I')).toBe(false);
  });

  it('normalizes VIN to uppercase without spaces', () => {
    expect(normalizeVin(' 1hgcm82633a004352 ')).toBe('1HGCM82633A004352');
  });

  it('validates check digit for a known-good VIN', () => {
    expect(isValidVinFormat('1HGCM82633A004352')).toBe(true);
    expect(isValidVinCheckDigit('1HGCM82633A004352')).toBe(true);
  });
});
