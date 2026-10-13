import { isRzlSafeText } from './rzl-text-rules.js';

describe('isRzlSafeText', () => {
  it('accepts plain text that Windows-1252 carries', () => {
    expect(isRzlSafeText('FN-AT-1')).toBe(true);
    expect(isRzlSafeText('8400')).toBe(true);
    expect(isRzlSafeText('Rückgabe Ö')).toBe(true);
  });

  it('rejects empty text', () => {
    expect(isRzlSafeText('')).toBe(false);
  });

  it('rejects the field separator, quotes and line breaks', () => {
    expect(isRzlSafeText('2000;1')).toBe(false);
    expect(isRzlSafeText('say "hi"')).toBe(false);
    expect(isRzlSafeText('line\nbreak')).toBe(false);
    expect(isRzlSafeText('carriage\rreturn')).toBe(false);
  });

  it('rejects formula-leading text', () => {
    expect(isRzlSafeText('=SUM(A1)')).toBe(false);
    expect(isRzlSafeText('+49')).toBe(false);
    expect(isRzlSafeText('-123')).toBe(false);
    expect(isRzlSafeText('@ref')).toBe(false);
  });

  it('rejects characters outside Windows-1252', () => {
    expect(isRzlSafeText('Test 😀')).toBe(false);
  });
});
