import type { Customer, Vehicle } from '@prisma/client';

// Test double: implements only the members these tests call.
export function asFake<T>(double: Partial<T>): T {
  return double as T;
}

// Complete Customer row; fields a test does not set get neutral values (null, false, NONE).
export function customerRow(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    tenant_id: 'tenant-1',
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Max',
    last_name: 'Mustermann',
    email: null,
    phone: null,
    vat_id: null,
    address_street: null,
    address_city: null,
    address_zip: null,
    address_country: null,
    contact_email_ok: false,
    preferred_language: null,
    legacy_restricted_at: null,
    legacy_restricted_reason: null,
    block_level: 'NONE',
    block_reason: null,
    salutation: null,
    title: null,
    title_suffix: null,
    letter_salutation: null,
    payment_terms_days: null,
    payment_terms_text: null,
    default_bill_to_customer_id: null,
    labor_price_group_id: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

// Complete Vehicle row; fields a test does not set get neutral values.
export function vehicleRow(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'vehicle-1',
    tenant_id: 'tenant-1',
    make: 'VW',
    model: 'Golf',
    year: 2020,
    engine_code: null,
    vin: null,
    plate: null,
    make_brand_id: null,
    hsn: null,
    tsn: null,
    identity_keys: null,
    identity_input_fingerprint: null,
    identity_resolved_at: null,
    identity_resolution_generation: null,
    identity_resolution_token: null,
    fuel_type: null,
    power_kw: null,
    customer_id: null,
    inventory_role: 'CUSTOMER',
    stock_status: null,
    stock_received_at: null,
    stock_cost_basis: null,
    tax_scheme: null,
    mileage: null,
    color: null,
    key_number: null,
    registration_certificate_no: null,
    first_registration_date: null,
    co2_wltp_g_km: null,
    co2_nedc_g_km: null,
    typenschein_no: null,
    national_code: null,
    nova_class: null,
    emission_class: null,
    site_id: null,
    location_id: null,
    reserved_for_customer_id: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
