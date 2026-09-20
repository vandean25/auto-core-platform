import { BadRequestException } from '@nestjs/common';
import type { LegalEntityCountry } from '@prisma/client';
import type { UpdateLegalEntityDto } from './dto/site.dto.js';

export type LegalEntitySellerRecord = {
  country_iso: LegalEntityCountry;
  name: string;
  address_street: string | null;
  address_line2: string | null;
  address_zip: string | null;
  address_city: string | null;
  tax_number: string | null;
  vat_id: string | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  email: string | null;
  phone: string | null;
  registration_number: string | null;
  registration_court: string | null;
  representatives: string | null;
  payment_terms_days: number | null;
  payment_terms_text: string | null;
};

export function normalizeOptionalString(
  value: string | undefined | null,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeUppercaseOptionalString(
  value: string | undefined | null,
): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toUpperCase() : null;
}

const IBAN_LENGTH_BY_COUNTRY: Record<string, number> = {
  AT: 20,
  DE: 22,
};

export function isValidIban(value: string): boolean {
  const normalized = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(normalized)) {
    return false;
  }

  const expectedLength = IBAN_LENGTH_BY_COUNTRY[normalized.slice(0, 2)];
  if (expectedLength !== undefined && normalized.length !== expectedLength) {
    return false;
  }

  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (character) =>
    String(character.charCodeAt(0) - 55),
  );

  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number.parseInt(digit, 10)) % 97;
  }

  return remainder === 1;
}

export function isValidBic(value: string): boolean {
  const normalized = value.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalized);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidDeVatId(value: string): boolean {
  return /^DE[0-9]{9}$/.test(value.replace(/\s+/g, '').toUpperCase());
}

export function isValidAtUid(value: string): boolean {
  return /^ATU[0-9]{8}$/.test(value.replace(/\s+/g, '').toUpperCase());
}

export function isValidDeTaxNumber(value: string): boolean {
  const normalized = value.replace(/[\s/]+/g, '');
  return /^[0-9]{9,13}$/.test(normalized);
}

export function isValidAtTaxNumber(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  return /^[0-9]{2}\/?[0-9]{3}\/?[0-9]{4}$/.test(normalized);
}

function assertMaxLength(
  field: string,
  value: string | null,
  maxLength: number,
): void {
  if (value !== null && value.length > maxLength) {
    throw new BadRequestException(
      `${field} must be at most ${maxLength} characters`,
    );
  }
}

function validateTaxIdentifiers(
  countryIso: LegalEntityCountry,
  taxNumber: string | null,
  vatId: string | null,
): void {
  if (taxNumber !== null) {
    const isValid =
      countryIso === 'DE'
        ? isValidDeTaxNumber(taxNumber)
        : isValidAtTaxNumber(taxNumber);
    if (!isValid) {
      throw new BadRequestException(
        `taxNumber is not a valid ${countryIso} tax number format`,
      );
    }
  }

  if (vatId !== null) {
    const isValid =
      countryIso === 'DE' ? isValidDeVatId(vatId) : isValidAtUid(vatId);
    if (!isValid) {
      throw new BadRequestException(
        `vatId is not a valid ${countryIso} VAT identifier format`,
      );
    }
  }
}

export function buildLegalEntitySellerUpdateData(
  existing: LegalEntitySellerRecord,
  dto: UpdateLegalEntityDto,
): Partial<LegalEntitySellerRecord> {
  const data: Partial<LegalEntitySellerRecord> = {};

  if (dto.name !== undefined) {
    data.name = dto.name.trim();
  }

  if (dto.addressStreet !== undefined) {
    data.address_street = normalizeOptionalString(dto.addressStreet);
  }
  if (dto.addressLine2 !== undefined) {
    data.address_line2 = normalizeOptionalString(dto.addressLine2);
  }
  if (dto.addressZip !== undefined) {
    data.address_zip = normalizeOptionalString(dto.addressZip);
  }
  if (dto.addressCity !== undefined) {
    data.address_city = normalizeOptionalString(dto.addressCity);
  }
  if (dto.taxNumber !== undefined) {
    data.tax_number = normalizeOptionalString(dto.taxNumber);
  }
  if (dto.vatId !== undefined) {
    data.vat_id = normalizeUppercaseOptionalString(dto.vatId);
  }
  if (dto.iban !== undefined) {
    const compacted = normalizeOptionalString(dto.iban)?.replace(/\s+/g, '');
    data.iban = compacted ? compacted.toUpperCase() : null;
  }
  if (dto.bic !== undefined) {
    data.bic = normalizeUppercaseOptionalString(dto.bic);
  }
  if (dto.bankName !== undefined) {
    data.bank_name = normalizeOptionalString(dto.bankName);
  }
  if (dto.email !== undefined) {
    data.email = normalizeOptionalString(dto.email)?.toLowerCase() ?? null;
  }
  if (dto.phone !== undefined) {
    data.phone = normalizeOptionalString(dto.phone);
  }
  if (dto.registrationNumber !== undefined) {
    data.registration_number = normalizeOptionalString(dto.registrationNumber);
  }
  if (dto.registrationCourt !== undefined) {
    data.registration_court = normalizeOptionalString(dto.registrationCourt);
  }
  if (dto.representatives !== undefined) {
    data.representatives = normalizeOptionalString(dto.representatives);
  }
  if (dto.paymentTermsDays !== undefined) {
    data.payment_terms_days = dto.paymentTermsDays;
  }
  if (dto.paymentTermsText !== undefined) {
    data.payment_terms_text = normalizeOptionalString(dto.paymentTermsText);
  }

  const merged: LegalEntitySellerRecord = {
    ...existing,
    ...data,
  };

  assertMaxLength('name', merged.name, 120);
  assertMaxLength('addressStreet', merged.address_street, 200);
  assertMaxLength('addressLine2', merged.address_line2, 200);
  assertMaxLength('addressZip', merged.address_zip, 20);
  assertMaxLength('addressCity', merged.address_city, 120);
  assertMaxLength('taxNumber', merged.tax_number, 32);
  assertMaxLength('vatId', merged.vat_id, 32);
  assertMaxLength('iban', merged.iban, 34);
  assertMaxLength('bic', merged.bic, 11);
  assertMaxLength('bankName', merged.bank_name, 120);
  assertMaxLength('email', merged.email, 254);
  assertMaxLength('phone', merged.phone, 40);
  assertMaxLength('registrationNumber', merged.registration_number, 64);
  assertMaxLength('registrationCourt', merged.registration_court, 120);
  assertMaxLength('representatives', merged.representatives, 500);
  assertMaxLength('paymentTermsText', merged.payment_terms_text, 1000);

  if (
    merged.payment_terms_days !== null &&
    (merged.payment_terms_days < 0 || merged.payment_terms_days > 365)
  ) {
    throw new BadRequestException(
      'paymentTermsDays must be between 0 and 365 when provided',
    );
  }

  if (merged.iban !== null && !isValidIban(merged.iban)) {
    throw new BadRequestException('iban is not a valid IBAN');
  }
  if (merged.bic !== null && !isValidBic(merged.bic)) {
    throw new BadRequestException('bic is not a valid BIC');
  }
  if (merged.email !== null && !isValidEmail(merged.email)) {
    throw new BadRequestException('email is not a valid email address');
  }

  validateTaxIdentifiers(
    existing.country_iso,
    merged.tax_number,
    merged.vat_id,
  );

  return data;
}
