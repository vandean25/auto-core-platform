import type { WorkshopEstimateSnapshot } from '../workshop-estimate-snapshot.js';
import { projectPublicEstimate } from './public-estimate-approval.projection.js';

function snapshotFixture(): WorkshopEstimateSnapshot {
  return {
    schema_version: 1,
    document: {
      kind: 'WORKSHOP_ESTIMATE',
      title: 'Kostenvoranschlag',
      estimate_number: 'KV-2026-0001',
      version: 2,
      issued_at: '2026-10-14T08:00:00.000Z',
      valid_from: '2026-10-14T08:00:00.000Z',
      valid_until: '2026-10-28T08:00:00.000Z',
      validity_days: 14,
      non_binding: true,
      free_of_charge: true,
      price_display: 'GROSS',
    },
    seller: {
      name: 'Werkstatt Muster GmbH',
      country_iso: 'AT',
      address_street: 'Musterweg 1',
      address_line2: null,
      address_zip: '1010',
      address_city: 'Wien',
      tax_number: '12 345/6789',
      vat_id: 'ATU00000000',
      iban: 'AT00 0000 0000 0000 0000',
      bic: 'BKAUATWW',
    } as unknown as WorkshopEstimateSnapshot['seller'],
    customer: {
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Max',
      last_name: 'Mustermann',
      email: 'max.mustermann@example.at',
      phone: '+43 1 2345678',
      vat_id: null,
      address_street: 'Beispielgasse 2',
      address_zip: '1020',
      address_city: 'Wien',
      address_country: 'AT',
    } as unknown as WorkshopEstimateSnapshot['customer'],
    vehicle: {
      make: 'VW',
      model: 'Golf',
      vin: null,
      plate: 'W 12345 A',
      year: 2019,
    },
    order: { order_number: 'WO-2026-0042', odometer: 120000 },
    lines: [
      {
        source_line_id: 'line-internal-1',
        type: 'PART',
        item_no: 'OIL-5W30',
        description: 'Motoröl 5W-30',
        quantity: '4',
        unit_price: '12.50',
        tax_rate: '20',
        net: '50.00',
        tax: '10.00',
        gross: '60.00',
      },
    ] as unknown as WorkshopEstimateSnapshot['lines'],
    totals: {
      total_net: '50.00',
      total_tax: '10.00',
      total_gross: '60.00',
      tax_breakdown: [],
    },
    branding: {
      logo_storage_key: 'brand/logo.png',
    } as unknown as WorkshopEstimateSnapshot['branding'],
    legal: {
      text_version: 'kv-legal-de-v1',
      text_sha256: 'abc123',
      paragraphs: ['Dieser Kostenvoranschlag ist unverbindlich.'],
    },
  };
}

describe('projectPublicEstimate', () => {
  it('shows the estimate document fields, the legal block and the lines', () => {
    const view = projectPublicEstimate(snapshotFixture());

    expect(view.document).toMatchObject({
      estimate_number: 'KV-2026-0001',
      valid_until: '2026-10-28T08:00:00.000Z',
      free_of_charge: true,
    });
    expect(view.legal.paragraphs).toEqual([
      'Dieser Kostenvoranschlag ist unverbindlich.',
    ]);
    expect(view.lines).toEqual([
      expect.objectContaining({
        item_no: 'OIL-5W30',
        description: 'Motoröl 5W-30',
        gross: '60.00',
      }),
    ]);
  });

  it('never copies the customer email or phone, the seller bank details, the branding or the internal line ids', () => {
    const serialised = JSON.stringify(projectPublicEstimate(snapshotFixture()));

    expect(serialised).not.toContain('max.mustermann@example.at');
    expect(serialised).not.toContain('+43 1 2345678');
    expect(serialised).not.toContain('AT00 0000 0000 0000 0000');
    expect(serialised).not.toContain('BKAUATWW');
    expect(serialised).not.toContain('brand/logo.png');
    expect(serialised).not.toContain('line-internal-1');
  });
});
