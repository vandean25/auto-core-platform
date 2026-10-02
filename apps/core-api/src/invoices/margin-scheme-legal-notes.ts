import { UnprocessableEntityException } from '@nestjs/common';

export const MARGIN_SCHEME_SELLER_COUNTRY_UNSUPPORTED_CODE =
  'MARGIN_SCHEME_SELLER_COUNTRY_UNSUPPORTED';

export type MarginSchemeSellerCountry = 'AT' | 'DE';

export const MARGIN_SCHEME_LEGAL_NOTES: Record<
  MarginSchemeSellerCountry,
  string
> = {
  DE: 'Gebrauchtgegenstände/Sonderregelung – Differenzbesteuerung gemäß § 25a UStG.',
  AT: 'Gebrauchtgegenstände/Sonderregelung – Differenzbesteuerung gemäß § 24 UStG 1994.',
};

export function isMarginSchemeSellerCountry(
  countryIso: string | undefined | null,
): countryIso is MarginSchemeSellerCountry {
  return countryIso === 'AT' || countryIso === 'DE';
}

export function assertMarginSchemeSellerCountrySupported(
  countryIso: string | undefined | null,
): MarginSchemeSellerCountry {
  if (!isMarginSchemeSellerCountry(countryIso)) {
    throw new UnprocessableEntityException({
      code: MARGIN_SCHEME_SELLER_COUNTRY_UNSUPPORTED_CODE,
      message:
        'Margin-scheme invoices require a supported seller country (DE or AT).',
      countryIso: countryIso ?? null,
    });
  }
  return countryIso;
}

export function resolveMarginSchemeLegalNote(
  countryIso: string | undefined | null,
): string {
  const country = assertMarginSchemeSellerCountrySupported(countryIso);
  return MARGIN_SCHEME_LEGAL_NOTES[country];
}
