import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PlaywrightBrowserService } from '../src/common/services/playwright-browser.service.js';
import { InvoicePdfRenderer } from '../src/invoices/invoice-pdf.renderer.js';
import type { InvoiceSnapshot } from '../src/invoices/invoice-snapshot.js';

const LONG_INVOICE_ITEM_COUNT = 100;
const LOGO_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

type Fixture = {
  country: 'AT' | 'DE';
  invoiceNumber: string;
  itemCount: number;
  marginScheme: boolean;
  branded: boolean;
};

const FIXTURES: Fixture[] = [
  {
    country: 'AT',
    invoiceNumber: 'RE-AT-DEFAULT-0001',
    itemCount: 1,
    marginScheme: false,
    branded: false,
  },
  {
    country: 'AT',
    invoiceNumber: 'RE-AT-CUSTOM-0002',
    itemCount: 1,
    marginScheme: false,
    branded: true,
  },
  {
    country: 'DE',
    invoiceNumber: 'RE-DE-STANDARD-0003',
    itemCount: LONG_INVOICE_ITEM_COUNT,
    marginScheme: false,
    branded: true,
  },
  {
    country: 'DE',
    invoiceNumber: 'RE-DE-MARGIN-0004',
    itemCount: LONG_INVOICE_ITEM_COUNT,
    marginScheme: true,
    branded: true,
  },
];

function createSnapshot(fixture: Fixture): InvoiceSnapshot {
  const totalNet = (fixture.itemCount * 100).toFixed(2);
  const totalTax = fixture.marginScheme
    ? '0.00'
    : (fixture.itemCount * 20).toFixed(2);
  const totalGross = fixture.marginScheme
    ? totalNet
    : (fixture.itemCount * 120).toFixed(2);

  return {
    id: `invoice-${fixture.invoiceNumber}`,
    invoice_number: fixture.invoiceNumber,
    date: '2026-09-20T00:00:00.000Z',
    due_date: '2026-10-04T00:00:00.000Z',
    total_net: totalNet,
    total_tax: totalTax,
    total_gross: totalGross,
    notes: 'Frozen legal fixture note',
    tax_mode: fixture.marginScheme ? 'MARGIN_SCHEME' : 'STANDARD',
    schema_version: 2,
    template_version: 'invoice-brand-v1',
    document_kind: 'INVOICE',
    currency: 'EUR',
    seller: {
      name: 'Werkstatt GmbH',
      country_iso: fixture.country,
      address_street: 'Hauptstraße 1',
      address_line2: null,
      address_zip: fixture.country === 'AT' ? '1010' : '10115',
      address_city: fixture.country === 'AT' ? 'Wien' : 'Berlin',
      tax_number: '12/345/67890',
      vat_id: fixture.country === 'AT' ? 'ATU12345678' : 'DE123456789',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
      bank_name: 'Commerzbank',
      email: 'rechnung@werkstatt.example',
      phone: '+4312345678',
      registration_number: 'FN 123456a',
      registration_court: 'Handelsgericht Wien',
      representatives: 'Max Mustermann',
    },
    supply_date_from: '2026-09-18',
    supply_date_to: '2026-09-20',
    payment_terms: {
      days: 14,
      text: 'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
    },
    tax_breakdown: fixture.marginScheme
      ? []
      : [
          {
            rate: '20.00',
            net: totalNet,
            tax: totalTax,
            gross: totalGross,
          },
        ],
    customer: {
      type: 'COMPANY',
      company_name: 'Kunden AG',
      first_name: 'Erika',
      last_name: 'Muster',
      email: 'erika@kunden.example',
      phone: '+43111111',
      vat_id: 'DE987654321',
      address_street: 'Kundenweg 9',
      address_city: fixture.country === 'AT' ? 'Graz' : 'München',
      address_zip: fixture.country === 'AT' ? '8010' : '80331',
      address_country: fixture.country === 'AT' ? 'Österreich' : 'Deutschland',
    },
    vehicle: {
      make: 'BMW',
      model: '320d',
      year: 2019,
      engine_code: null,
      vin: 'WBA8E9G50JNU12345',
      plate: 'W-AB 1234',
    },
    items: Array.from({ length: fixture.itemCount }, (_, index) => ({
      description: `Fixture line ${String(index + 1).padStart(3, '0')} — ${'protected service detail '.repeat(6)}`,
      quantity: '1',
      unit_price: '100.00',
      tax_rate: fixture.marginScheme ? '0.00' : '20.00',
      line_discount_type: null,
      line_discount_value: null,
      line_total: '100.00',
      revenue_group_name: 'Service',
    })),
    snapshot_created_at: '2026-09-20T12:00:00.000Z',
    branding: {
      schema_version: 1,
      profile_id: fixture.branded ? 'profile-1' : null,
      profile_revision: fixture.branded ? 3 : 0,
      preset_id: 'standard-v1',
      renderer_version: 'invoice-brand-v1',
      font_id: 'acp-sans-v1',
      tokens: {
        primary_color: fixture.branded ? '#334155' : '#111827',
        secondary_color: '#E5E7EB',
        header_band: fixture.branded ? 'primary' : 'none',
        footer_band: fixture.branded ? 'secondary' : 'none',
        header_text: fixture.branded ? 'Workshop & North' : '',
        footer_text: 'Keine Veränderung der Rechnungsdaten.',
      },
      logo: fixture.branded
        ? {
            asset_id: 'asset-1',
            bucket: 'test-bucket',
            key: 'test/logo.png',
            generation: '1',
            sha256: createHash('sha256').update(LOGO_BYTES).digest('hex'),
            mime_type: 'image/png',
            width: 1,
            height: 1,
          }
        : null,
      resolved_at: '2026-09-20T12:00:00.000Z',
    },
  };
}

async function readPdfText(pdfBytes: Buffer) {
  const document = await getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  const pageCount = document.numPages;
  const pages = await Promise.all(
    Array.from({ length: pageCount }, async (_, index) => {
      const page = await document.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join(' ');
    }),
  );
  await document.destroy();
  return { pageCount, text: pages.join(' ') };
}

describe('branded invoice render fixtures (e2e)', () => {
  let browserService: PlaywrightBrowserService;
  let renderer: InvoicePdfRenderer;
  let artifactDirectory: string;
  let externalRequests: string[];

  beforeAll(async () => {
    browserService = new PlaywrightBrowserService();
    artifactDirectory = await mkdtemp(join(tmpdir(), 'aut323-render-'));
    externalRequests = [];
    const browser = await browserService.getBrowser();

    const observedBrowser = {
      newPage: async () => {
        const page = await browser.newPage();
        page.on('request', (request) => {
          if (/^https?:\/\//.test(request.url())) {
            externalRequests.push(request.url());
          }
        });
        return page;
      },
    };
    renderer = new InvoicePdfRenderer({
      getBrowser: async () => observedBrowser,
      withTimeout: <T>(promise: Promise<T>) => promise,
    } as never);
  });

  afterAll(async () => {
    await browserService.onModuleDestroy();
    if (artifactDirectory) {
      await rm(artifactDirectory, { recursive: true, force: true });
    }
  });

  it('branded rendering never requests external resources', async () => {
    externalRequests.length = 0;
    const snapshot = createSnapshot(FIXTURES[1]);
    snapshot.branding!.tokens.header_text =
      'https://attacker.example/logo.png';

    await renderer.render(snapshot, { logoPng: LOGO_BYTES });

    expect(externalRequests).toEqual([]);
  });

  it.each(FIXTURES)(
    '$invoiceNumber preserves protected content and exact totals',
    async (fixture) => {
      externalRequests.length = 0;
      const snapshot = createSnapshot(fixture);
      const pdfBytes = await renderer.render(
        snapshot,
        fixture.branded ? { logoPng: LOGO_BYTES } : undefined,
      );
      const artifactPath = join(artifactDirectory, `${fixture.invoiceNumber}.pdf`);
      await writeFile(artifactPath, pdfBytes);
      const { pageCount, text: extractedText } = await readPdfText(pdfBytes);
      const normalizedText = extractedText.replace(/\s+/g, ' ').trim();

      expect(normalizedText).toContain('Werkstatt GmbH');
      expect(normalizedText).toContain('Kunden AG');
      expect(normalizedText).toContain(fixture.invoiceNumber);
      expect(normalizedText).toContain(
        'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
      );
      expect(normalizedText).toContain('Hauptstraße 1');
      expect(normalizedText).toContain(
        fixture.country === 'AT' ? 'UID: ATU12345678' : 'USt-IdNr.: DE123456789',
      );
      expect(normalizedText).toContain('IBAN: DE89370400440532013000');
      expect(normalizedText).toContain('Fixture line 001');
      expect(normalizedText).toContain(
        `Fixture line ${String(fixture.itemCount).padStart(3, '0')}`,
      );

      if (fixture.marginScheme) {
        expect(normalizedText).toContain(
          'Differenzbesteuerung gemäß § 24 UStG',
        );
        expect(normalizedText).toContain(`Brutto: ${snapshot.total_gross}`);
        expect(normalizedText).not.toContain('Umsatzsteuer:');
      } else {
        expect(normalizedText).toContain(`Netto: ${snapshot.total_net}`);
        expect(normalizedText).toContain(
          `Umsatzsteuer: ${snapshot.total_tax}`,
        );
        expect(normalizedText).toContain(`Brutto: ${snapshot.total_gross}`);
      }

      if (fixture.itemCount === 1) {
        expect(pageCount).toBeGreaterThanOrEqual(1);
      } else {
        expect(pageCount).toBeGreaterThanOrEqual(10);
      }
      expect(externalRequests).toEqual([]);
      await expect(readFile(artifactPath)).resolves.toEqual(pdfBytes);
    },
  );
});
