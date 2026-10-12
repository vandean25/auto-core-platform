import { isSingleLineText } from './header-text.js';

describe('isSingleLineText()', () => {
  it('accepts names with commas and quotes, which adapters quote themselves', () => {
    expect(isSingleLineText('Müller, Schmidt & Partner GmbH')).toBe(true);
    expect(isSingleLineText('Werkstatt "Nord"')).toBe(true);
  });

  it('refuses the C1 controls at both ends of their range, and both Unicode separators', () => {
    expect(isSingleLineText('Name\u0080Next')).toBe(false);
    expect(isSingleLineText('Name\u0085Next')).toBe(false);
    expect(isSingleLineText('Name\u009fNext')).toBe(false);
    expect(isSingleLineText('Name Next')).toBe(false);
    expect(isSingleLineText('Name Next')).toBe(false);
  });

  it('accepts a no-break space, which is not a control character', () => {
    expect(isSingleLineText('Werkstatt Nord')).toBe(true);
  });

  it('refuses bidi overrides and isolates and zero-width characters, which make a name read differently', () => {
    expect(isSingleLineText('Werkstatt ‮gro.live')).toBe(false);
    expect(isSingleLineText('Name⁦x⁩')).toBe(false);
    expect(isSingleLineText('Name​x')).toBe(false);
    expect(isSingleLineText('Name﻿x')).toBe(false);
  });

  it('refuses line breaks, other control characters and the Unicode line separators', () => {
    expect(isSingleLineText('Auftrag\r\nBcc: victim@evil.example')).toBe(false);
    expect(isSingleLineText('Name\tTab')).toBe(false);
    expect(isSingleLineText('Name\u0000')).toBe(false);
    expect(isSingleLineText('Name\u007f')).toBe(false);
    expect(isSingleLineText('Name Next')).toBe(false);
  });
});
