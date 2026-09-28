import * as themeModule from './theme-v1.js';

const DEFAULT_THEME = {
  schemaVersion: 1,
  presetId: 'standard-v1',
  logoAssetId: null,
  primaryColor: '#111827',
  secondaryColor: '#E5E7EB',
  fontId: 'acp-sans-v1',
  headerBand: 'none',
  footerBand: 'none',
  headerText: '',
  footerText: '',
} as const;

function validateTheme(value: unknown) {
  const validate = (themeModule as unknown as Record<string, unknown>)
    .validateDocumentBrandTheme as (input: unknown) => unknown;
  return validate(value);
}

describe('ThemeV1 validation', () => {
  it('exports the public ThemeV1 validator', () => {
    expect(
      typeof (themeModule as unknown as Record<string, unknown>)
        .validateDocumentBrandTheme,
    ).toBe('function');
  });

  it('returns the canonical default theme', () => {
    expect(validateTheme(DEFAULT_THEME)).toEqual(DEFAULT_THEME);
  });

  it('normalizes colors, line endings, and Unicode text to canonical form', () => {
    const validated = validateTheme({
      ...DEFAULT_THEME,
      primaryColor: '#2a4b6b',
      headerText: 'Mu\u0308nchen\r\nBrief',
    });

    expect(validated).toMatchObject({
      primaryColor: '#2A4B6B',
      headerText: 'München\nBrief',
    });
  });

  it.each([
    ['unknown top-level properties', { ...DEFAULT_THEME, css: 'body{}' }],
    [
      'unknown properties in nested token data',
      { ...DEFAULT_THEME, extra: {} },
    ],
    ['invalid preset identifiers', { ...DEFAULT_THEME, presetId: 'classic' }],
    ['non-hex colors', { ...DEFAULT_THEME, primaryColor: 'red' }],
    [
      'markup delimiters',
      { ...DEFAULT_THEME, headerText: '<strong>Invoice</strong>' },
    ],
    ['template interpolation', { ...DEFAULT_THEME, footerText: '${secret}' }],
    [
      'bidirectional formatting controls',
      { ...DEFAULT_THEME, headerText: 'Safe\u202Eevil' },
    ],
    [
      'more than two header lines',
      { ...DEFAULT_THEME, headerText: 'one\ntwo\nthree' },
    ],
    ['footer newlines', { ...DEFAULT_THEME, footerText: 'one\ntwo' }],
    [
      'text longer than 120 code points',
      { ...DEFAULT_THEME, footerText: 'x'.repeat(121) },
    ],
  ])('rejects %s', (_caseName, value) => {
    expect(() => validateTheme(value)).toThrow(
      'Invalid document branding theme',
    );
  });

  it('returns the contrast-specific error code for a low-contrast primary color', () => {
    try {
      validateTheme({ ...DEFAULT_THEME, primaryColor: '#EEEEEE' });
      throw new Error('Expected theme validation to fail');
    } catch (error) {
      expect(error).toMatchObject({
        response: expect.objectContaining({ code: 'BRAND_COLOR_CONTRAST' }),
      });
    }
  });
});
