import { BadRequestException } from '@nestjs/common';
import {
  isValidAtUid,
  isValidDeVatId,
  normalizeUppercaseOptionalString,
} from '../site/legal-entity-seller.validation.js';

export const CUSTOMER_VAT_ID_INVALID_CODE = 'CUSTOMER_VAT_ID_INVALID';

export function normalizeCustomerVatId(
  value: string | undefined | null,
): string | null {
  return normalizeUppercaseOptionalString(value);
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

  const countryIso = normalizeCountryIso(addressCountry);
  if (countryIso === 'AT') {
    if (!isValidAtUid(normalizedVatId)) {
      throw new BadRequestException({
        code: CUSTOMER_VAT_ID_INVALID_CODE,
        message: 'vat_id is not a valid AT VAT identifier format',
        field: 'vat_id',
      });
    }
    return;
  }

  if (countryIso === 'DE') {
    if (!isValidDeVatId(normalizedVatId)) {
      throw new BadRequestException({
        code: CUSTOMER_VAT_ID_INVALID_CODE,
        message: 'vat_id is not a valid DE VAT identifier format',
        field: 'vat_id',
      });
    }
  }
}
