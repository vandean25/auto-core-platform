import { BadRequestException } from '@nestjs/common';
import { findCountryPack } from '../common/country-pack/country-pack.registry.js';
import { normalizeUppercaseOptionalString } from '../site/legal-entity-seller.validation.js';

export const CUSTOMER_VAT_ID_INVALID_CODE = 'CUSTOMER_VAT_ID_INVALID';

export function normalizeCustomerVatId(
  value: string | undefined | null,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeUppercaseOptionalString(value.replace(/\s+/g, ''));
}

function normalizeCountryIso(
  addressCountry: string | null | undefined,
): string | null {
  const trimmed = addressCountry?.trim().toUpperCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function assertCustomerVatIdFormat(
  addressCountry: string | null | undefined,
  vatId: string | null | undefined,
): void {
  const normalizedVatId = normalizeCustomerVatId(vatId);
  if (!normalizedVatId) {
    return;
  }

  const pack = findCountryPack(normalizeCountryIso(addressCountry));
  if (pack && !pack.validateVatId(normalizedVatId)) {
    throw new BadRequestException({
      code: CUSTOMER_VAT_ID_INVALID_CODE,
      message: `vat_id is not a valid ${pack.countryIso} VAT identifier format`,
      field: 'vat_id',
    });
  }
}
