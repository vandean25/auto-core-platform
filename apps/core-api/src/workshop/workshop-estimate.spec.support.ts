import { createHash } from 'node:crypto';
import {
  CustomerType,
  LegalEntityCountry,
  WorkshopLineItemType,
} from '@prisma/client';
import type { InvoiceSnapshotV2Branding } from '../invoices/invoice-snapshot-v2.js';
import {
  buildWorkshopEstimateSnapshot,
  buildWorkshopEstimateValidityWindow,
  type BuildWorkshopEstimateSnapshotInput,
  type WorkshopEstimateSnapshot,
} from './workshop-estimate-snapshot.js';

export const ESTIMATE_ISSUED_AT = new Date('2026-10-10T08:00:00.000Z');

export const estimateBrandingFixture: InvoiceSnapshotV2Branding = {
  schema_version: 1,
  profile_id: null,
  profile_revision: 0,
  preset_id: 'standard-v1',
  renderer_version: 'invoice-brand-v1',
  font_id: 'acp-sans-v1',
  tokens: {
    primary_color: '#1f2937',
    secondary_color: '#64748b',
    header_band: 'none',
    footer_band: 'none',
    header_text: '#111827',
    footer_text: '#111827',
  },
  logo: null,
  resolved_at: '2026-10-10T08:00:00.000Z',
};

export function buildEstimateSnapshotInput(
  overrides: Partial<BuildWorkshopEstimateSnapshotInput> = {},
): BuildWorkshopEstimateSnapshotInput {
  const { validFrom, validUntil } =
    buildWorkshopEstimateValidityWindow(ESTIMATE_ISSUED_AT);
  return {
    estimateNumber: 'KV-2026-0001',
    version: 1,
    issuedAt: ESTIMATE_ISSUED_AT,
    validFrom,
    validUntil,
    freeOfCharge: true,
    seller: {
      name: 'Musterwerkstatt GmbH',
      country_iso: LegalEntityCountry.AT,
      address_street: 'Werkstraße 1',
      address_zip: '1010',
      address_city: 'Wien',
    },
    customer: {
      type: CustomerType.PRIVATE,
      company_name: null,
      first_name: 'Anna',
      last_name: 'Beispiel',
      email: 'anna@example.test',
      phone: null,
      vat_id: null,
      address_street: 'Hauptstraße 2',
      address_city: 'Graz',
      address_zip: '8010',
      address_country: 'AT',
    },
    vehicle: {
      make: 'Skoda',
      model: 'Octavia',
      vin: null,
      plate: 'W 123 AB',
      year: 2019,
    },
    order: { order_number: 'WO-2026-0007', odometer: 98450 },
    lines: [
      {
        source_line_id: 'line-1',
        type: WorkshopLineItemType.LABOR,
        item_no: 'LAB-OIL',
        description: 'Ölwechsel',
        quantity: '2.000',
        unit_price: '90.00',
        tax_rate: '20.00',
        net: '180.00',
        tax: '36.00',
        gross: '216.00',
      },
    ],
    totals: {
      total_net: '180.00',
      total_tax: '36.00',
      total_gross: '216.00',
      tax_breakdown: [
        { rate: '20.00', net: '180.00', tax: '36.00', gross: '216.00' },
      ],
    },
    branding: estimateBrandingFixture,
    ...overrides,
  };
}

export function buildEstimateSnapshot(
  overrides: Partial<BuildWorkshopEstimateSnapshotInput> = {},
): WorkshopEstimateSnapshot {
  return buildWorkshopEstimateSnapshot(buildEstimateSnapshotInput(overrides));
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
