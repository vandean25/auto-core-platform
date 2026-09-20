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

  if (entity.country_iso === 'DE') {
    if (!entity.tax_number?.trim() && !entity.vat_id?.trim()) {
      missingFields.push('tax_number_or_vat_id');
    }
  } else if (!entity.vat_id?.trim()) {
    missingFields.push('vat_id');
  }

  const hasPaymentTerms =
    entity.payment_terms_days !== null &&
    entity.payment_terms_days !== undefined
      ? true
      : Boolean(entity.payment_terms_text?.trim());

  if (!hasPaymentTerms) {
    missingFields.push('payment_terms');
  }

  return {
    isReady: missingFields.length === 0,
    missingFields,
  };
}
