import { CustomerType, WorkshopLineItemType } from '@prisma/client';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import {
  buildWorkshopEstimateFooterTemplate,
  buildWorkshopEstimateHeaderTemplate,
  buildWorkshopEstimateHtmlDocument,
  formatEstimateMoney,
} from './workshop-estimate-pdf.layout.js';
import {
  buildWorkshopEstimateValidityWindow,
  formatWorkshopEstimateValidUntil,
} from './workshop-estimate-snapshot.js';
import {
  buildEstimateSnapshot,
  ESTIMATE_ISSUED_AT,
  estimateBrandingFixture,
} from './workshop-estimate.spec.support.js';

const FONT_CSS = '/* font fixture */';
const LOGO_URL = 'data:image/png;base64,AAAA';

describe('workshop estimate PDF layout', () => {
  it('prints the title, the estimate number and version, and the exact expiry', () => {
    const snapshot = buildEstimateSnapshot();
    const html = buildWorkshopEstimateHtmlDocument(snapshot, FONT_CSS, escapeHtml);

    const { validUntil } = buildWorkshopEstimateValidityWindow(ESTIMATE_ISSUED_AT);
    expect(html).toContain('<h1>Kostenvoranschlag</h1>');
    expect(html).toContain('KV-2026-0001 · Version 1');
    expect(html).toContain('Gültig bis');
    expect(html).toContain(`${formatWorkshopEstimateValidUntil(validUntil)} Uhr`);
    expect(html).toContain('WO-2026-0007');
    expect(html).toContain(
      `${new Intl.NumberFormat('de-AT').format(98450)} km`,
    );
  });

  it('prints the frozen legal paragraphs as stored and includes the free-of-charge sentence only while free', () => {
    const free = buildEstimateSnapshot();
    const freeHtml = buildWorkshopEstimateHtmlDocument(free, FONT_CSS, escapeHtml);
    for (const paragraph of free.legal.paragraphs) {
      expect(freeHtml).toContain(escapeHtml(paragraph));
    }
    expect(freeHtml).toContain('Die Erstellung dieses Kostenvoranschlags ist für Sie kostenlos.');

    const paid = buildEstimateSnapshot({ freeOfCharge: false });
    const paidHtml = buildWorkshopEstimateHtmlDocument(paid, FONT_CSS, escapeHtml);
    expect(paidHtml).not.toContain('ist für Sie kostenlos');
  });

  it('keeps the legal copy within the approved wording (no e-signature term, no price-increase sentence)', () => {
    const html = buildWorkshopEstimateHtmlDocument(
      buildEstimateSnapshot(),
      FONT_CSS,
      escapeHtml,
    );

    expect(html).not.toMatch(/digital signiert/i);
    expect(html).not.toMatch(/Preiserhöhung|Preissteigerung/i);
    expect(html).toContain('unverbindlich');
  });

  it('prints the gross total with its breakdown for a private customer', () => {
    const snapshot = buildEstimateSnapshot();
    const html = buildWorkshopEstimateHtmlDocument(snapshot, FONT_CSS, escapeHtml);

    expect(snapshot.document.price_display).toBe('GROSS');
    expect(html).toContain('Gesamtbetrag brutto');
    expect(html).toContain(formatEstimateMoney('216.00'));
    expect(html).toContain('Betrag brutto');
    expect(html).not.toContain('Einzelpreis netto');
    expect(html).toContain('<table class="tax-breakdown">');
  });

  it('prints net amounts with the VAT lines for a company customer', () => {
    const snapshot = buildEstimateSnapshot({
      customer: {
        type: CustomerType.COMPANY,
        company_name: 'Flotte Test GmbH',
        first_name: 'Anna',
        last_name: 'Beispiel',
        email: 'fleet@example.test',
        phone: null,
        vat_id: 'ATU12345678',
        address_street: 'Hauptstraße 2',
        address_city: 'Graz',
        address_zip: '8010',
        address_country: 'AT',
      },
    });
    const html = buildWorkshopEstimateHtmlDocument(snapshot, FONT_CSS, escapeHtml);

    expect(snapshot.document.price_display).toBe('NET_WITH_VAT');
    expect(html).toContain('Einzelpreis netto');
    expect(html).toContain('Betrag netto');
    expect(html).toContain('Flotte Test GmbH');
    expect(html).toContain('UID: ATU12345678');
    expect(html).toContain('Gesamtbetrag brutto');
  });

  it('escapes customer, vehicle and line text instead of rendering it as markup', () => {
    const snapshot = buildEstimateSnapshot({
      customer: {
        type: CustomerType.PRIVATE,
        company_name: null,
        first_name: '<img src=x onerror=alert(1)>',
        last_name: 'Beispiel',
        email: null,
        phone: null,
        vat_id: null,
        address_street: null,
        address_city: null,
        address_zip: null,
        address_country: null,
      },
      lines: [
        {
          source_line_id: 'line-x',
          type: WorkshopLineItemType.PART,
          item_no: 'PRT-1',
          description: '<script>alert(1)</script>',
          quantity: '1.000',
          unit_price: '10.00',
          tax_rate: '20.00',
          net: '10.00',
          tax: '2.00',
          gross: '12.00',
        },
      ],
      totals: {
        total_net: '10.00',
        total_tax: '2.00',
        total_gross: '12.00',
        tax_breakdown: [{ rate: '20.00', net: '10.00', tax: '2.00', gross: '12.00' }],
      },
    });
    const html = buildWorkshopEstimateHtmlDocument(snapshot, FONT_CSS, escapeHtml);

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('uses only a six-digit hex colour from the frozen tokens', () => {
    const snapshot = buildEstimateSnapshot({
      branding: {
        ...estimateBrandingFixture,
        tokens: {
          ...estimateBrandingFixture.tokens,
          primary_color: 'red;}body{display:none',
        },
      },
    });
    const html = buildWorkshopEstimateHtmlDocument(snapshot, FONT_CSS, escapeHtml);
    const header = buildWorkshopEstimateHeaderTemplate(snapshot, null, escapeHtml);

    expect(html).not.toContain('display:none');
    expect(html).toContain('color: #111827');
    expect(header).not.toContain('display:none');
  });

  it('places the logo in the page header only when a frozen logo is pinned', () => {
    const withoutLogo = buildEstimateSnapshot();
    expect(
      buildWorkshopEstimateHeaderTemplate(withoutLogo, null, escapeHtml, FONT_CSS),
    ).not.toContain('<img');

    const withLogo = buildEstimateSnapshot({
      branding: {
        ...estimateBrandingFixture,
        logo: {
          asset_id: 'asset-1',
          bucket: 'brand-assets',
          key: 'logos/asset-1.png',
          generation: '17',
          sha256: 'a'.repeat(64),
          mime_type: 'image/png',
          width: 120,
          height: 40,
        },
      },
    });
    const header = buildWorkshopEstimateHeaderTemplate(
      withLogo,
      LOGO_URL,
      escapeHtml,
      FONT_CSS,
    );
    expect(header).toContain(`src="${LOGO_URL}"`);
    expect(
      buildWorkshopEstimateHtmlDocument(withLogo, FONT_CSS, escapeHtml),
    ).not.toContain('<img');
  });

  it('labels every page footer with the estimate number, version and page numbers', () => {
    const footer = buildWorkshopEstimateFooterTemplate(
      buildEstimateSnapshot(),
      escapeHtml,
      FONT_CSS,
    );

    expect(footer).toContain('Kostenvoranschlag KV-2026-0001 · Version 1');
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
  });

  it('keeps the issue date on the printed document', () => {
    const html = buildWorkshopEstimateHtmlDocument(
      buildEstimateSnapshot(),
      FONT_CSS,
      escapeHtml,
    );
    expect(html).toContain('10.10.2026');
  });
});
