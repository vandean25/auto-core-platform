import type { LegalEntity } from '@prisma/client';
import type { UpdateLegalEntityDto } from './dto/site.dto.js';
import type { buildLegalEntitySellerUpdateData } from './legal-entity-seller.validation.js';

type SellerUpdate = ReturnType<typeof buildLegalEntitySellerUpdateData>;

const SELLER_PROFILE_KEYS = [
  'address_street',
  'address_line2',
  'address_zip',
  'address_city',
  'tax_number',
  'vat_id',
  'iban',
  'bic',
  'bank_name',
  'email',
  'phone',
  'registration_number',
  'registration_court',
  'representatives',
  'payment_terms_days',
  'payment_terms_text',
] as const satisfies readonly (keyof SellerUpdate)[];

export function buildLegalEntityProfileUpdateData(
  existing: LegalEntity,
  dto: UpdateLegalEntityDto,
  sellerUpdate: SellerUpdate,
) {
  const data: Record<string, unknown> = {
    name: sellerUpdate.name ?? existing.name,
    is_active: dto.isActive ?? existing.is_active,
  };

  for (const key of SELLER_PROFILE_KEYS) {
    const value = sellerUpdate[key];
    if (value !== undefined) {
      data[key] = value;
    }
  }

  if (dto.rksvMode !== undefined) {
    data.rksv_mode = dto.rksvMode;
  }

  return data;
}
