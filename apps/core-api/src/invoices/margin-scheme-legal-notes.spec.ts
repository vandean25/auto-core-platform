import { UnprocessableEntityException } from '@nestjs/common';
import {
  MARGIN_SCHEME_LEGAL_NOTES,
  MARGIN_SCHEME_SELLER_COUNTRY_UNSUPPORTED_CODE,
  assertMarginSchemeSellerCountrySupported,
  resolveMarginSchemeLegalNote,
} from './margin-scheme-legal-notes.js';

describe('margin-scheme-legal-notes', () => {
  it('returns German statutory wording for DE sellers', () => {
    expect(resolveMarginSchemeLegalNote('DE')).toBe(
      MARGIN_SCHEME_LEGAL_NOTES.DE,
    );
    expect(MARGIN_SCHEME_LEGAL_NOTES.DE).toContain('§ 25a UStG');
    expect(MARGIN_SCHEME_LEGAL_NOTES.DE).toContain(
      'Gebrauchtgegenstände/Sonderregelung',
    );
    expect(MARGIN_SCHEME_LEGAL_NOTES.DE).not.toContain('§ 24 UStG');
  });

  it('returns Austrian wording for AT sellers', () => {
    expect(resolveMarginSchemeLegalNote('AT')).toBe(
      MARGIN_SCHEME_LEGAL_NOTES.AT,
    );
    expect(MARGIN_SCHEME_LEGAL_NOTES.AT).toContain('§ 24 UStG 1994');
    expect(MARGIN_SCHEME_LEGAL_NOTES.AT).toContain(
      'Gebrauchtgegenstände/Sonderregelung',
    );
    expect(MARGIN_SCHEME_LEGAL_NOTES.AT).not.toContain('§ 25a');
  });

  it('fails closed for missing or unsupported seller countries', () => {
    for (const country of [undefined, null, '', 'CH', 'US']) {
      expect(() => assertMarginSchemeSellerCountrySupported(country)).toThrow(
        UnprocessableEntityException,
      );
      try {
        assertMarginSchemeSellerCountrySupported(country);
      } catch (error) {
        expect(error).toMatchObject({
          response: {
            code: MARGIN_SCHEME_SELLER_COUNTRY_UNSUPPORTED_CODE,
          },
        });
      }
    }
  });
});
