import { resolveCountryPack } from '../../common/country-pack/country-pack.registry.js';

export const DEFAULT_DE_PROFILE_CODE =
  resolveCountryPack('DE').defaultAccountingProfile;
export const DEFAULT_AT_PROFILE_CODE =
  resolveCountryPack('AT').defaultAccountingProfile;
export const DEFAULT_FORMAT_VERSION = 'EXTF-700-Buchungsstapel-13';
/**
 * ACP identifier of the RZL FIBU K/C/B draft layout in
 * `rzl-fibu-import.serializer.ts`. It is not RZL's Euro-Version column file.
 * Public handbook source S1 (August 2026) is mapped in the RZL spec; see
 * docs/internal/02-Feature-Specs/Finance/rzl-accounting-export.md.
 */
export const DEFAULT_RZL_FORMAT_VERSION = 'RZL-FIBU-IMPORT-ACP-DRAFT-1';
/** Platform release gate for RZL CSV generation and enablement. Default OFF until AUT-368. */
export const RZL_SERIALIZER_RELEASE_ENV =
  'ACCOUNTING_EXPORT_RZL_SERIALIZER_ENABLED';

export function isRzlSerializerReleased(): boolean {
  return process.env[RZL_SERIALIZER_RELEASE_ENV] === 'true';
}

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

/**
 * Whether a profile may be enabled and generate CSV. DATEV is released for DE
 * (AUT-307); RZL stays closed until the platform flag is on (AUT-368 validation).
 */
export function isExportSerializerReleased(
  profileCode: string | null | undefined,
): boolean {
  if (isDatevProfileCode(profileCode)) {
    return true;
  }
  if (isRzlProfileCode(profileCode)) {
    return isRzlSerializerReleased();
  }
  return false;
}

export function defaultProfileCodeForCountry(
  countryIso: 'AT' | 'DE',
): string | null {
  return resolveCountryPack(countryIso).defaultAccountingProfile;
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
