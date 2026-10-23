import type { Customer, CustomerType, Prisma } from '@prisma/client';
import { confirmationAfterEmailWrite } from './customer-contact-email.js';
import type {
  CustomerCreateFields,
  CustomerProposalFields,
} from './customer-propose.payload.js';
import type { CustomerProposeAddress } from './customer-propose.schema.js';
import {
  assertCustomerVatIdFormat,
  normalizeCustomerVatId,
} from './customer-vat-id.validation.js';
import { withPhoneDigits } from './customer-phone.util.js';

const ADDRESS_COLUMN_BY_KEY = {
  street: 'address_street',
  zip: 'address_zip',
  city: 'address_city',
  country: 'address_country',
} as const;

type AddressColumn =
  (typeof ADDRESS_COLUMN_BY_KEY)[keyof typeof ADDRESS_COLUMN_BY_KEY];

function addressColumn(key: string): AddressColumn {
  return ADDRESS_COLUMN_BY_KEY[key as keyof typeof ADDRESS_COLUMN_BY_KEY];
}

/** The submitted fields whose value differs from the stored one. */
export function changedFields(
  customer: Customer,
  submitted: CustomerProposalFields,
): CustomerProposalFields {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(submitted)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'address') {
      const address = changedAddress(customer, value as CustomerProposeAddress);
      if (address) {
        changed.address = address;
      }
      continue;
    }
    if (storedValue(customer, key) !== value) {
      changed[key] = value;
    }
  }
  return changed;
}

function changedAddress(
  customer: Customer,
  address: CustomerProposeAddress,
): CustomerProposeAddress | null {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(address)) {
    if (value === undefined) {
      continue;
    }
    if (customer[addressColumn(key)] !== value) {
      changed[key] = value;
    }
  }
  return Object.keys(changed).length > 0 ? changed : null;
}

/** The stored values of the fields a proposal changes. */
export function currentFields(
  customer: Customer,
  changes: CustomerProposalFields,
): CustomerProposalFields {
  const current: Record<string, unknown> = {};
  for (const key of Object.keys(changes)) {
    if (key === 'address') {
      const address = changes.address as CustomerProposeAddress;
      const currentAddress: Record<string, unknown> = {};
      for (const addressKey of Object.keys(address)) {
        currentAddress[addressKey] = customer[addressColumn(addressKey)];
      }
      current.address = currentAddress;
      continue;
    }
    current[key] = storedValue(customer, key);
  }
  return current;
}

function storedValue(customer: Customer, key: string): unknown {
  if (key === 'customer_type') {
    return customer.type;
  }
  return (customer as unknown as Record<string, unknown>)[key];
}

/** The customer row a create proposal writes. */
export function toCustomerCreateData(
  fields: CustomerCreateFields,
  tenantId: string,
): Prisma.CustomerUncheckedCreateInput {
  assertCustomerVatIdFormat(fields.address?.country ?? null, fields.vat_id);
  const data: Prisma.CustomerUncheckedCreateInput = {
    tenant_id: tenantId,
    type: fields.customer_type as CustomerType,
    first_name: fields.first_name,
    last_name: fields.last_name,
  };
  assignOptional(data, 'company_name', fields.company_name);
  assignOptional(data, 'email', fields.email);
  assignOptional(data, 'phone', fields.phone);
  assignOptional(data, 'vat_id', normalizeCustomerVatId(fields.vat_id));
  assignOptional(data, 'preferred_language', fields.preferred_language);
  assignAddress(data, fields.address);
  return withPhoneDigits(data);
}

/**
 * The customer row an update proposal writes. A changed e-mail address
 * withdraws the advisor confirmation of that address (ADR-0025 §8).
 */
export function toCustomerUpdateData(
  customer: Customer,
  changes: CustomerProposalFields,
): Prisma.CustomerUncheckedUpdateInput {
  const data: Prisma.CustomerUncheckedUpdateInput = {};
  if (changes.customer_type !== undefined) {
    data.type = changes.customer_type as CustomerType;
  }
  assignOptional(data, 'first_name', changes.first_name);
  assignOptional(data, 'last_name', changes.last_name);
  assignOptional(data, 'company_name', changes.company_name);
  assignOptional(data, 'email', changes.email);
  assignOptional(data, 'phone', changes.phone);
  assignOptional(data, 'vat_id', normalizeCustomerVatId(changes.vat_id));
  assignOptional(data, 'preferred_language', changes.preferred_language);
  if (changes.address) {
    assertCustomerVatIdFormat(
      changes.address.country ?? customer.address_country,
      customer.vat_id,
    );
    assignAddress(data, changes.address);
  }
  if (
    confirmationAfterEmailWrite(customer.email, { email: changes.email }) ===
    false
  ) {
    data.contact_email_ok = false;
  }
  return withPhoneDigits(data);
}

function assignOptional(
  data: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
): void {
  if (value !== undefined && value !== null) {
    data[key] = value;
  }
}

function assignAddress(
  data: Record<string, unknown>,
  address: CustomerProposeAddress | undefined,
): void {
  if (!address) {
    return;
  }
  for (const [key, value] of Object.entries(address)) {
    if (value === undefined) {
      continue;
    }
    data[addressColumn(key)] = value;
  }
}
