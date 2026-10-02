export const DEFAULT_DE_PROFILE_CODE = 'ACP-DATEV-DE-EUR-1';
export const DEFAULT_AT_PROFILE_CODE = 'ACP-RZL-AT-EUR-1';
export const DEFAULT_FORMAT_VERSION = 'EXTF-700-Buchungsstapel-13';
export const DEFAULT_RZL_FORMAT_VERSION = 'RZL-FIBU-IMPORT-PENDING';

export function isDatevProfileCode(
  profileCode: string | null | undefined,
): boolean {
  return profileCode === DEFAULT_DE_PROFILE_CODE;
}

export function isRzlProfileCode(
  profileCode: string | null | undefined,
): boolean {
  return profileCode === DEFAULT_AT_PROFILE_CODE;
}

export function isExportSerializerImplemented(
  profileCode: string | null | undefined,
): boolean {
  return isDatevProfileCode(profileCode);
}

export function defaultProfileCodeForCountry(
  countryIso: 'AT' | 'DE',
): string | null {
  if (countryIso === 'DE') {
    return DEFAULT_DE_PROFILE_CODE;
  }
  return DEFAULT_AT_PROFILE_CODE;
}

export function defaultFormatVersionForProfileCode(
  profileCode: string | null | undefined,
): string | null {
  if (isDatevProfileCode(profileCode)) {
    return DEFAULT_FORMAT_VERSION;
  }
  if (isRzlProfileCode(profileCode)) {
    return DEFAULT_RZL_FORMAT_VERSION;
  }
  return null;
}

export function defaultFormatVersionForCountry(
  countryIso: 'AT' | 'DE',
): string | null {
  return defaultFormatVersionForProfileCode(
    defaultProfileCodeForCountry(countryIso),
  );
}
