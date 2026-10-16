import {
  CustomerType,
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
} from '@prisma/client';
import {
  DEFAULT_AT_PROFILE_CODE,
  DEFAULT_DE_PROFILE_CODE,
} from '../finance/accounting-profile/accounting-profile.codes.js';
import type { ResolvedAccountingAllocation } from '../finance/accounting-profile/accounting-profile.types.js';
import {
  buildCreditNoteLineSnapshot,
  buildCreditNoteSnapshot,
  type CreditNoteSnapshotV2,
} from '../credit-notes/credit-note-snapshot.js';
import {
  buildInvoiceSnapshotV2,
  type InvoiceSnapshotV2,
} from './invoice-snapshot-v2.js';

type BuildInvoiceSnapshotInput = Parameters<typeof buildInvoiceSnapshotV2>[0];

/**
 * A committed v2 vehicle margin-scheme invoice for an AT or DE seller, built with the production
 * snapshot builder. The Prisma-shaped inputs are minimal fixtures; only the fields the builder reads
 * are populated.
 */
export function createMarginSchemeSnapshotV2(
  countryIso: 'AT' | 'DE',
): InvoiceSnapshotV2 {
  const accountingAllocation: ResolvedAccountingAllocation = {
    profileCode:
      countryIso === 'AT' ? DEFAULT_AT_PROFILE_CODE : DEFAULT_DE_PROFILE_CODE,
    profileVersion: 1,
    sourceCategoryKey: 'vehicle_margin',
    sourceCategoryLabel: 'Vehicle margin scheme',
    revenueAccount: '8600',
    debtorAccount: '1000',
    taxMode: 'MARGIN_SCHEME',
    taxRate: '0.00',
    taxTreatment: 'automatic',
    buKey: null,
    countryIso,
    currency: 'EUR',
  };

  const invoice = {
    id: 'inv-margin-1',
    tenant_id: 'tenant-1',
    invoice_number: 'RE-2026-0099',
    customer_id: 'cust-1',
    vehicle_id: 'veh-1',
    vehicle_sale_id: 'vs-1',
    sales_order_id: null,
    workshop_order_id: null,
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
    status: InvoiceStatus.FINALIZED,
    date: new Date('2026-09-20T10:00:00.000Z'),
    due_date: new Date('2026-10-04T10:00:00.000Z'),
    supply_date_from: new Date('2026-09-20T00:00:00.000Z'),
    supply_date_to: new Date('2026-09-20T00:00:00.000Z'),
    currency: 'EUR',
    global_discount_type: null,
    global_discount_value: null,
    total_net: new Prisma.Decimal('14500.00'),
    total_tax: new Prisma.Decimal('500.00'),
    total_gross: new Prisma.Decimal('15000.00'),
    notes: null,
    internal_notes: null,
    items: [],
    customer: {
      id: 'cust-1',
      tenant_id: 'tenant-1',
      type: CustomerType.COMPANY,
      company_name: 'Kunden AG',
      first_name: 'Erika',
      last_name: 'Muster',
      email: 'erika@kunden.example',
      phone: '+43111111',
      vat_id: 'DE987654321',
      address_street: 'Kundenweg 9',
      address_city: 'Graz',
      address_zip: '8010',
      address_country: 'Österreich',
    },
    vehicle: {
      id: 'veh-1',
      make: 'BMW',
      model: '320d',
      year: 2019,
      engine_code: null,
      vin: 'WBA8E9G50JNU12345',
      plate: 'W-AB 1234',
    },
  } as unknown as BuildInvoiceSnapshotInput['invoice'];

  const seller = {
    id: 'le-1',
    tenant_id: 'tenant-1',
    name: countryIso === 'AT' ? 'Werkstatt Wien GmbH' : 'Werkstatt Berlin GmbH',
    country_iso: countryIso,
    address_street: 'Hauptstraße 1',
    address_line2: null,
    address_zip: countryIso === 'AT' ? '1010' : '10115',
    address_city: countryIso === 'AT' ? 'Wien' : 'Berlin',
    tax_number: countryIso === 'AT' ? null : '27/010/12345',
    vat_id: countryIso === 'AT' ? 'ATU12345678' : 'DE123456789',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    bank_name: 'Commerzbank',
    email: 'rechnung@werkstatt.example',
    phone: null,
    registration_number: null,
    registration_court: null,
    representatives: null,
    payment_terms_days: 14,
    payment_terms_text: 'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
  } as unknown as BuildInvoiceSnapshotInput['seller'];

  return buildInvoiceSnapshotV2({
    invoice,
    seller,
    siteId: 'site-1',
    legalEntityId: 'le-1',
    lineAllocations: [
      {
        id: 'line-margin',
        description: '2019 BMW 320d VIN WBA8E9G50JNU12345',
        quantity: new Prisma.Decimal('1.000'),
        unitPrice: new Prisma.Decimal('15000.00'),
        taxRate: new Prisma.Decimal('20.00'),
        lineDiscountType: null,
        lineDiscountValue: null,
        revenueGroupName: 'Vehicle used (margin)',
        accountingAllocation,
      },
    ],
    documentLocale: 'de',
    margin: {
      cost_basis: '12000.00',
      margin_tax: '500.00',
      tax_rate: '20.00',
      calculation_profile: 'vehicle-margin-v1',
    },
    committedAt: new Date('2026-09-20T12:00:00.000Z'),
  });
}

/** Full-document credit of every line of a margin-scheme snapshot, as the credit-note service builds it. */
export function createFullMarginCreditNote(
  original: InvoiceSnapshotV2,
): CreditNoteSnapshotV2 {
  return buildCreditNoteSnapshot({
    originalSnapshot: original,
    originalInvoiceId: 'inv-margin-1',
    originalInvoiceNumber: 'RE-2026-0099',
    originalInvoiceDate: new Date('2026-09-20T10:00:00.000Z'),
    reason: 'Stornierung Fahrzeugverkauf',
    creditDate: new Date('2026-10-12T00:00:00.000Z'),
    isFullCredit: true,
    lineSnapshots: original.items.map((item) =>
      buildCreditNoteLineSnapshot({
        originalItemId: item.id,
        originalSnapshotItem: item,
        quantity: new Prisma.Decimal(item.quantity),
        net: new Prisma.Decimal(item.net),
        tax: new Prisma.Decimal(item.tax),
        gross: new Prisma.Decimal(item.gross),
      }),
    ),
    committedAt: new Date('2026-10-12T10:00:00.000Z'),
  });
}
