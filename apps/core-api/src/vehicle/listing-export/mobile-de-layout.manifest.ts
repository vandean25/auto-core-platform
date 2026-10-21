/**
 * Pinned mobile.de positional layout for MOBILE_DE_REFERENCE_V1 (columns 0..211).
 * Source: https://services.mobile.de/manual/upload-interface-csv_de.html (AUT-569).
 */

/** Used-stock export always sets neufahrzeug=0 (route requires inventory_role=USED). */
export const MOBILE_DE_REFERENCE_USED_CAR_DEFAULTS: Readonly<
  Record<number, string>
> = {
  21: '0', // neufahrzeug
};

export const MOBILE_DE_LISTING_REF_MAX_LENGTH = 40;

const INTERNAL_NUMBER_PATTERN = /^[A-Za-z0-9_-]+$/;

export function assertMobileDeInternalNumber(listingRef: string): void {
  if (
    listingRef.length === 0 ||
    listingRef.length > MOBILE_DE_LISTING_REF_MAX_LENGTH
  ) {
    throw new Error('mobile.de interne_nummer must be 1..40 characters.');
  }
  if (!INTERNAL_NUMBER_PATTERN.test(listingRef)) {
    throw new Error(
      'mobile.de interne_nummer allows only A-Z, a-z, 0-9, hyphen and underscore.',
    );
  }
}

export function mobileDeImageFilename(
  imageId: string,
  sequence: number,
): string {
  const suffix = String(sequence).padStart(2, '0');
  return `${imageId}_${suffix}.jpg`;
}

export function mobileDeImageIdFromListingRef(listingRef: string): string {
  assertMobileDeInternalNumber(listingRef);
  return listingRef;
}

/** Maps ACP fuel labels to mobile.de kraftstoffart (109). */
export function mapMobileDeFuelCode(fuel: string | null): string {
  if (!fuel) {
    return '';
  }
  const normalized = fuel.trim().toLowerCase();
  if (normalized.includes('diesel')) return '2';
  if (normalized.includes('elektro') || normalized === 'electric') return '6';
  if (normalized.includes('hybrid')) return '7';
  if (normalized.includes('gas') || normalized.includes('lpg')) return '3';
  if (normalized.includes('erdgas') || normalized.includes('cng')) return '4';
  if (normalized.includes('wasserstoff') || normalized.includes('hydrogen')) {
    return '8';
  }
  if (normalized.includes('ethanol')) return '9';
  if (normalized.includes('benzin') || normalized.includes('petrol'))
    return '1';
  return '0';
}

export function formatMobileDeMonthYear(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date for mobile.de ez field: ${isoDate}`);
  }
  return `${match[2]}.${match[1]}`;
}

export function formatMobileDePriceGross(amount: string): string {
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid gross price for mobile.de export: ${amount}`);
  }
  return parsed.toFixed(2);
}

export function mapMobileDeVatIndicator(
  vatDisplay: 'STANDARD' | 'MARGIN',
): string {
  return vatDisplay === 'MARGIN' ? '1' : '0';
}
