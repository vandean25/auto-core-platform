import { isSingleLineText } from './header-text.js';

describe('isSingleLineText()', () => {
  it('accepts names with commas and quotes, which adapters quote themselves', () => {
    expect(isSingleLineText('Müller, Schmidt & Partner GmbH')).toBe(true);
    expect(isSingleLineText('Werkstatt "Nord"')).toBe(true);
  });

  it('refuses line breaks, other control characters and the Unicode line separators', () => {
    expect(isSingleLineText('Auftrag\r\nBcc: victim@evil.example')).toBe(false);
    expect(isSingleLineText('Name\tTab')).toBe(false);
    expect(isSingleLineText('Name\u0000')).toBe(false);
    expect(isSingleLineText('Name\u007f')).toBe(false);
    expect(isSingleLineText('Name Next')).toBe(false);
  });
});
