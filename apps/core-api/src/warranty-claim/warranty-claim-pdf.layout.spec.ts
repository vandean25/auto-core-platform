import {
  buildWarrantyClaimFooterTemplate,
  buildWarrantyClaimHeaderTemplate,
  buildWarrantyClaimHtml,
  formatDeEuro,
  type WarrantyClaimPdfContent,
} from './warranty-claim-pdf.layout.js';
import type { WarrantyClaimResponse } from './warranty-claim.mapper.js';

function claimFixture(overrides: Partial<WarrantyClaimResponse> = {}): WarrantyClaimResponse {
  return {
    id: '5f1c1d2e-0000-4000-8000-000000000001',
    workshopOrderId: '5f1c1d2e-0000-4000-8000-000000000002',
    type: 'KULANZ',
    status: 'SUBMITTED_EXTERNALLY',
    complaint: 'Kupplung rutscht bei Kaltstart',
    causeCorrection: 'Geberzylinder getauscht',
    claimedAmountNet: '1250.00',
    linesNetAmount: '1250.00',
    externalReference: 'REF-2026-0042',
    decisionDate: null,
    decisionNote: null,
    submittedAt: '2026-10-10T08:30:00.000Z',
    closedAt: null,
    createdAt: '2026-10-09T10:00:00.000Z',
    updatedAt: '2026-10-10T08:30:00.000Z',
    lines: [
      {
        id: 'line-1',
        workshopTaskLineItemId: 'item-1',
        lineType: 'PART',
        itemNo: 'A1234567',
        description: 'Geberzylinder',
        quantity: '1.000',
        unitPrice: '1000.00',
        netAmount: '1000.00',
      },
      {
        id: 'line-2',
        workshopTaskLineItemId: 'item-2',
        lineType: 'LABOR',
        itemNo: 'LAB-KUPPLUNG',
        description: 'Kupplung entlüften',
        quantity: '2.500',
        unitPrice: '100.00',
        netAmount: '250.00',
      },
    ],
    ...overrides,
  };
}

function contentFixture(overrides: Partial<WarrantyClaimPdfContent> = {}): WarrantyClaimPdfContent {
  return {
    claim: claimFixture(),
    order: {
      orderNumber: 'WO-2026-0007',
      odometer: 84210,
      vehicle: { make: 'Demo', model: 'Roadster', vin: 'DEMOVIN00000000001', plate: 'W-DEMO-1' },
    },
    seller: { name: 'Demo Werkstatt GmbH', addressLines: ['Musterweg 1', '1010 Wien'], vatId: 'ATU00000000' },
    tokens: { primaryColor: '#0a7d4b', secondaryColor: '#111827' },
    logoDataUrl: null,
    generatedAt: new Date('2026-10-10T09:00:00.000Z'),
    ...overrides,
  };
}

describe('warranty claim PDF layout', () => {
  it('formats amounts in EUR with German notation', () => {
    expect(formatDeEuro('1250')).toBe('1.250,00 €');
    expect(formatDeEuro('0.5')).toBe('0,50 €');
  });

  it('lists every affected line with unit and net amounts in EUR, and the lines total', () => {
    const html = buildWarrantyClaimHtml(contentFixture(), { fontFaceCss: '' });

    expect(html).toContain('Geberzylinder');
    expect(html).toContain('Kupplung entlüften');
    expect(html).toContain('A1234567');
    expect(html).toContain('1.000,00 €');
    expect(html).toContain('250,00 €');
    expect(html).toContain('Summe der Positionen (netto)');
    expect(html).toContain('1.250,00 €');
    expect(html).toContain('Arbeit');
    expect(html).toContain('Teil');
  });

  it('uses the claim type title and the German status label', () => {
    const html = buildWarrantyClaimHtml(contentFixture(), { fontFaceCss: '' });
    expect(html).toContain('<h1>Kulanzantrag</h1>');
    expect(html).toContain('Beim Hersteller eingereicht');
    expect(html).toContain('REF-2026-0042');
  });

  it('escapes user-entered text instead of rendering it as markup', () => {
    const html = buildWarrantyClaimHtml(
      contentFixture({
        claim: claimFixture({
          complaint: '<img src=x onerror=alert(1)>',
          causeCorrection: 'Tom & Jerry <script>',
        }),
      }),
      { fontFaceCss: '' },
    );

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Tom &amp; Jerry &lt;script&gt;');
  });

  it('applies valid brand tokens and falls back to defaults for malformed colours', () => {
    const branded = buildWarrantyClaimHtml(contentFixture(), { fontFaceCss: '' });
    expect(branded).toContain('--primary: #0a7d4b;');
    expect(branded).toContain('--secondary: #111827;');

    const malformed = buildWarrantyClaimHtml(
      contentFixture({ tokens: { primaryColor: 'red; background: url(x)', secondaryColor: '#12' } }),
      { fontFaceCss: '' },
    );
    expect(malformed).toContain('--primary: #1d4ed8;');
    expect(malformed).toContain('--secondary: #0f172a;');
  });

  it('renders the logo only when one is provided', () => {
    expect(buildWarrantyClaimHeaderTemplate(contentFixture(), '')).not.toContain('<img');
    expect(
      buildWarrantyClaimHeaderTemplate(
        contentFixture({ logoDataUrl: 'data:image/png;base64,AAAA' }),
        '',
      ),
    ).toContain('<img src="data:image/png;base64,AAAA"');
  });

  it('carries the seller and order number into the header and footer', () => {
    const content = contentFixture({ seller: { name: 'Demo Werkstatt & Söhne GmbH', addressLines: [], vatId: null } });
    expect(buildWarrantyClaimHeaderTemplate(content, '')).toContain('Demo Werkstatt &amp; Söhne GmbH');
    const footer = buildWarrantyClaimFooterTemplate(content, '');
    expect(footer).toContain('Auftrag WO-2026-0007');
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
  });

  it('marks missing optional values with a dash instead of printing null', () => {
    const html = buildWarrantyClaimHtml(
      contentFixture({
        claim: claimFixture({ complaint: null, causeCorrection: null, claimedAmountNet: null, externalReference: null, lines: [] }),
        order: {
          orderNumber: 'WO-1',
          odometer: null,
          vehicle: { make: 'Demo', model: 'Roadster', vin: null, plate: null },
        },
      }),
      { fontFaceCss: '' },
    );
    expect(html).not.toContain('null');
    expect(html).toContain('Keine Positionen zugeordnet.');
    expect(html).toContain('Kilometerstand bei Annahme</td><td>–</td>');
  });
});
