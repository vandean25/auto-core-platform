import { CustomerType, LegalEntityCountry, WorkshopLineItemType } from '@prisma/client';
import type { InvoiceSnapshotV2Branding } from '../invoices/invoice-snapshot-v2.js';
import {
  buildWorkshopEstimateSnapshot,
  buildWorkshopEstimateValidityWindow,
  formatWorkshopEstimateDate,
  formatWorkshopEstimateValidUntil,
  hashWorkshopEstimateSnapshot,
  type BuildWorkshopEstimateSnapshotInput,
} from './workshop-estimate-snapshot.js';
import { WORKSHOP_ESTIMATE_BRANDED_TEMPLATE_VERSION } from './workshop-estimate.constants.js';

const branding: InvoiceSnapshotV2Branding = {
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

const ISSUED_AT = new Date('2026-10-10T08:00:00.000Z');

function input(
  overrides: Partial<BuildWorkshopEstimateSnapshotInput> = {},
): BuildWorkshopEstimateSnapshotInput {
  const { validFrom, validUntil } = buildWorkshopEstimateValidityWindow(ISSUED_AT);
  return {
    estimateNumber: 'KV-2026-0001',
    version: 1,
    issuedAt: ISSUED_AT,
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
      tax_breakdown: [{ rate: '20.00', net: '180.00', tax: '36.00', gross: '216.00' }],
    },
    branding,
    ...overrides,
  };
}

describe('workshop estimate snapshot', () => {
  it('marks the document non-binding with a 14-day validity window', () => {
    const snapshot = buildWorkshopEstimateSnapshot(input());

    expect(snapshot.document).toMatchObject({
      kind: 'WORKSHOP_ESTIMATE',
      title: 'Kostenvoranschlag',
      estimate_number: 'KV-2026-0001',
      version: 1,
      non_binding: true,
      validity_days: 14,
      valid_from: '2026-10-10T08:00:00.000Z',
      valid_until: '2026-10-24T08:00:00.000Z',
    });
  });

  it('shows gross prices to consumers and net prices with VAT to companies', () => {
    expect(buildWorkshopEstimateSnapshot(input()).document.price_display).toBe(
      'GROSS',
    );
    const company = buildWorkshopEstimateSnapshot(
      input({
        customer: {
          ...input().customer,
          type: CustomerType.COMPANY,
          company_name: 'Fuhrpark Beispiel KG',
        },
      }),
    );
    expect(company.document.price_display).toBe('NET_WITH_VAT');
  });

  it('labels the frozen branding with the estimate renderer version', () => {
    const snapshot = buildWorkshopEstimateSnapshot(input());

    expect(snapshot.branding.renderer_version).toBe(
      WORKSHOP_ESTIMATE_BRANDED_TEMPLATE_VERSION,
    );
    expect(snapshot.branding.resolved_at).toBe('2026-10-10T08:00:00.000Z');
  });

  it('includes the free-of-charge sentence only while the estimate is free', () => {
    const free = buildWorkshopEstimateSnapshot(input({ freeOfCharge: true }));
    const paid = buildWorkshopEstimateSnapshot(input({ freeOfCharge: false }));

    expect(free.legal.paragraphs.join(' ')).toContain('für Sie kostenlos');
    expect(paid.legal.paragraphs.join(' ')).not.toContain('kostenlos');
    expect(paid.document.free_of_charge).toBe(false);
  });

  it('hashes the whole snapshot canonically and changes with its content', () => {
    const snapshot = buildWorkshopEstimateSnapshot(input());
    const copy = JSON.parse(JSON.stringify(snapshot));

    expect(hashWorkshopEstimateSnapshot(copy)).toBe(
      hashWorkshopEstimateSnapshot(snapshot),
    );
    const changed = buildWorkshopEstimateSnapshot(
      input({
        lines: [{ ...snapshot.lines[0], description: 'Ölwechsel + Filter' }],
      }),
    );
    expect(hashWorkshopEstimateSnapshot(changed)).not.toBe(
      hashWorkshopEstimateSnapshot(snapshot),
    );
  });

  it('formats the document date in Vienna business time', () => {
    expect(formatWorkshopEstimateDate(new Date('2026-10-23T22:30:00.000Z'))).toBe(
      '24.10.2026',
    );
  });

  it('prints the exact expiry instant that the stored cut-off uses', () => {
    const snapshot = buildWorkshopEstimateSnapshot(input());

    expect(snapshot.document.valid_until).toBe('2026-10-24T08:00:00.000Z');
    expect(snapshot.legal.paragraphs.join(' ')).toContain(
      'Gültig bis 24.10.2026, 10:00 Uhr.',
    );
    expect(formatWorkshopEstimateValidUntil(new Date(snapshot.document.valid_until))).toBe(
      '24.10.2026, 10:00',
    );
  });

  it('floors a send that carries seconds, so the stored expiry is the printed minute', () => {
    const issuedAt = new Date('2026-10-10T08:00:37.512Z');
    const { validFrom, validUntil } = buildWorkshopEstimateValidityWindow(issuedAt);
    const snapshot = buildWorkshopEstimateSnapshot(
      input({ issuedAt, validFrom, validUntil }),
    );

    expect(snapshot.document.issued_at).toBe('2026-10-10T08:00:37.512Z');
    expect(snapshot.document.valid_from).toBe('2026-10-10T08:00:00.000Z');
    expect(snapshot.document.valid_until).toBe('2026-10-24T08:00:00.000Z');
    expect(snapshot.document.valid_until).toMatch(/:00\.000Z$/);
    expect(validUntil.getTime() - validFrom.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
    expect(snapshot.legal.paragraphs.join(' ')).toContain(
      'Gültig bis 24.10.2026, 10:00 Uhr.',
    );
  });
});
