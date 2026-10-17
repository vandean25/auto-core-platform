import {
  quoteMobileDeField,
  sanitizeMobileDeCsvFieldValue,
} from './mobile-de-csv.util.js';
import { MOBILE_DE_DESCRIPTION_LINE_BREAK } from './mobile-de-format.constants.js';

describe('mobile-de CSV field sanitization', () => {
  it('replaces raw line breaks with the mobile.de in-field escape', () => {
    expect(sanitizeMobileDeCsvFieldValue('a\nb\rc\r\nd')).toBe(
      `a${MOBILE_DE_DESCRIPTION_LINE_BREAK}b${MOBILE_DE_DESCRIPTION_LINE_BREAK}c${MOBILE_DE_DESCRIPTION_LINE_BREAK}d`,
    );
  });

  it('quotes sanitized values so the row stays one physical line', () => {
    const quoted = quoteMobileDeField('make\nmodel');
    expect(quoted).not.toMatch(/\n|\r/);
    expect(quoted).toContain(MOBILE_DE_DESCRIPTION_LINE_BREAK);
  });
});
