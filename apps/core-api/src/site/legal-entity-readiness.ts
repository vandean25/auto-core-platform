import { resolveCountryPack } from '../common/country-pack/country-pack.registry.js';
import type { LegalEntitySellerRecord } from './legal-entity-seller.validation.js';

export type SellerReadiness = {
  isReady: boolean;
  missingFields: string[];
};

export function computeSellerReadiness(
  entity: LegalEntitySellerRecord,
): SellerReadiness {
  const missingFields: string[] = [];

  if (!entity.name?.trim()) {
    missingFields.push('name');
  }
  if (!entity.address_street?.trim()) {
    missingFields.push('address_street');
  }
  if (!entity.address_zip?.trim()) {
    missingFields.push('address_zip');
  }
  if (!entity.address_city?.trim()) {
    missingFields.push('address_city');
  }

  const pack = resolveCountryPack(entity.country_iso);
  const hasTaxIdentifier =
    entity.vat_id?.trim() ||
    (pack.sellerTaxIdentifier === 'tax_number_or_vat_id' &&
      entity.tax_number?.trim());
  if (!hasTaxIdentifier) {
    missingFields.push(pack.sellerTaxIdentifier);
  }

  if (
    entity.payment_terms_days === null ||
    entity.payment_terms_days === undefined
  ) {
    missingFields.push('payment_terms_days');
  }
  if (!entity.payment_terms_text?.trim()) {
    missingFields.push('payment_terms_text');
  }

  return {
    isReady: missingFields.length === 0,
    missingFields,
  };
}
