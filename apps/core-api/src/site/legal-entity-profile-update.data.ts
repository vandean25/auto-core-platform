import type { LegalEntity } from '@prisma/client';
import type { UpdateLegalEntityDto } from './dto/site.dto.js';
import type { buildLegalEntitySellerUpdateData } from './legal-entity-seller.validation.js';

type SellerUpdate = ReturnType<typeof buildLegalEntitySellerUpdateData>;

export function buildLegalEntityProfileUpdateData(
  existing: LegalEntity,
  dto: UpdateLegalEntityDto,
  sellerUpdate: SellerUpdate,
) {
  return {
    name: sellerUpdate.name ?? existing.name,
    is_active: dto.isActive ?? existing.is_active,
    ...(sellerUpdate.address_street !== undefined
      ? { address_street: sellerUpdate.address_street }
      : {}),
    ...(sellerUpdate.address_line2 !== undefined
      ? { address_line2: sellerUpdate.address_line2 }
      : {}),
    ...(sellerUpdate.address_zip !== undefined
      ? { address_zip: sellerUpdate.address_zip }
      : {}),
    ...(sellerUpdate.address_city !== undefined
      ? { address_city: sellerUpdate.address_city }
      : {}),
    ...(sellerUpdate.tax_number !== undefined
      ? { tax_number: sellerUpdate.tax_number }
      : {}),
    ...(sellerUpdate.vat_id !== undefined
      ? { vat_id: sellerUpdate.vat_id }
      : {}),
    ...(sellerUpdate.iban !== undefined ? { iban: sellerUpdate.iban } : {}),
    ...(sellerUpdate.bic !== undefined ? { bic: sellerUpdate.bic } : {}),
    ...(sellerUpdate.bank_name !== undefined
      ? { bank_name: sellerUpdate.bank_name }
      : {}),
    ...(sellerUpdate.email !== undefined ? { email: sellerUpdate.email } : {}),
    ...(sellerUpdate.phone !== undefined ? { phone: sellerUpdate.phone } : {}),
    ...(sellerUpdate.registration_number !== undefined
      ? { registration_number: sellerUpdate.registration_number }
      : {}),
    ...(sellerUpdate.registration_court !== undefined
      ? { registration_court: sellerUpdate.registration_court }
      : {}),
    ...(sellerUpdate.representatives !== undefined
      ? { representatives: sellerUpdate.representatives }
      : {}),
    ...(sellerUpdate.payment_terms_days !== undefined
      ? { payment_terms_days: sellerUpdate.payment_terms_days }
      : {}),
    ...(sellerUpdate.payment_terms_text !== undefined
      ? { payment_terms_text: sellerUpdate.payment_terms_text }
      : {}),
    ...(dto.rksvMode !== undefined ? { rksv_mode: dto.rksvMode } : {}),
  };
}
