import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PlaywrightBrowserService } from '../src/common/services/playwright-browser.service.js';
import { InvoicePdfRenderer } from '../src/invoices/invoice-pdf.renderer.js';
import type { InvoiceSnapshot } from '../src/invoices/invoice-snapshot.js';
import {
  createDocumentBrandingVisualFixtures,
  createTransparentLogoPng,
  type VisualFixture,
} from '../scripts/document-branding-visual-fixtures.js';

const LONG_INVOICE_ITEM_COUNT = 100;
const LONG_COURT_TEXT = `Handelsgericht Wien ${'mit ergänzenden Firmenbuchangaben '.repeat(8)}`;
const LONG_REPRESENTATIVE_TEXT = `Max Mustermann ${'bevollmächtigter Vertreter '.repeat(12)}`;
const MARGIN_SCHEME_DE_NOTE = 'Differenzbesteuerung gemäß § 24 UStG (Gebrauchtgegenstände).';
const MARGIN_SCHEME_AT_NOTE = 'Differenzbesteuerung gemäß § 24 UStG 1994 (Gebrauchtgegenstände).';
const LONG_HEADER_VISIBLE_PREFIX = 'Workshop & North Worksh';
const LONG_FOOTER_TEXT = `Keine Veränderung der Rechnungsdaten. ${'Werkstatt Service '.repeat(12)}`;
const LONG_FOOTER_VISIBLE_PREFIX = 'Keine Veränderung der Rechnungsdaten. Werkstatt';
const RENDERER_VERSION = 'invoice-brand-v1';
const FONT_ID = 'acp-sans-v1';
const FONT_MANIFEST_PATH = new URL(
  '../src/document-branding/assets/font-manifest.json',
  import.meta.url,
);
const FIXTURES = createDocumentBrandingVisualFixtures();

type VisualArtifactEntry = {
  fixture_id: string;
  country: VisualFixture['country'];
  tax_profile: VisualFixture['taxProfile'];
  header_band: VisualFixture['headerBand'];
  footer_band: VisualFixture['footerBand'];
  logo_dimensions: VisualFixture['logo'];
  page_count: number;
  pdf_sha256: string;
};

type VisualArtifactManifest = {
  renderer_version: typeof RENDERER_VERSION;
  font_id: typeof FONT_ID;
  font_manifest_sha256: string;
  chromium_version: string;
  generated_at_utc: string;
  approvals: {
    status: 'PENDING';
    reviewer: null;
    reviewed_at: null;
    evidence_url: null;
  };
  fixtures: VisualArtifactEntry[];
};

function invoiceNumberFor(fixture: VisualFixture): string {
  return `RE-${fixture.country}-${fixture.id.toUpperCase()}`;
}

function createSnapshot(fixture: VisualFixture): InvoiceSnapshot {
  const invoiceNumber = invoiceNumberFor(fixture);
  const totalNet = (fixture.itemCount * 100).toFixed(2);
  const totalTax = fixture.taxProfile === 'margin'
    ? '0.00'
    : (fixture.itemCount * 20).toFixed(2);
  const totalGross = fixture.taxProfile === 'margin'
    ? totalNet
    : (fixture.itemCount * 120).toFixed(2);
  const decorativeText = fixture.decorativeTextLength
    ? 'Workshop & North '.repeat(8).slice(0, fixture.decorativeTextLength)
    : '';
  const longLegalText = fixture.longLegalFields
    ? LONG_COURT_TEXT
    : 'Handelsgericht Wien';

  return {
    id: `invoice-${invoiceNumber}`,
    invoice_number: invoiceNumber,
    date: '2026-09-20T00:00:00.000Z',
    due_date: '2026-10-04T00:00:00.000Z',
    total_net: totalNet,
    total_tax: totalTax,
    total_gross: totalGross,
    notes: 'Frozen legal fixture note',
    tax_mode: fixture.taxProfile === 'margin' ? 'MARGIN_SCHEME' : 'STANDARD',
    schema_version: 2,
    template_version: RENDERER_VERSION,
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
      registration_court: longLegalText,
      representatives: fixture.longLegalFields
        ? LONG_REPRESENTATIVE_TEXT
        : 'Max Mustermann',
    },
    supply_date_from: '2026-09-18',
    supply_date_to: '2026-09-20',
    payment_terms: {
      days: 14,
      text: 'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
    },
    tax_breakdown: fixture.taxProfile === 'margin'
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
      tax_rate: fixture.taxProfile === 'margin' ? '0.00' : '20.00',
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
      renderer_version: RENDERER_VERSION,
      font_id: FONT_ID,
      tokens: {
        primary_color: fixture.branded ? '#334155' : '#111827',
        secondary_color: '#E5E7EB',
        header_band: fixture.headerBand,
        footer_band: fixture.footerBand,
        header_text: decorativeText,
        footer_text: fixture.branded
          ? fixture.decorativeTextLength === 120
            ? LONG_FOOTER_TEXT
            : 'Keine Veränderung der Rechnungsdaten.'
          : '',
      },
      logo: fixture.logo
        ? {
            asset_id: `asset-${fixture.id}`,
            bucket: 'test-bucket',
            key: `test/${fixture.id}.png`,
            generation: '1',
            sha256: '',
            mime_type: 'image/png',
            width: fixture.logo.width,
            height: fixture.logo.height,
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
  let cleanupArtifactDirectory: boolean;
  let externalRequests: string[];
  let manifest: VisualArtifactManifest;

  beforeAll(async () => {
    browserService = new PlaywrightBrowserService();
    const configuredArtifactDirectory = process.env.DOCUMENT_BRANDING_VISUAL_ARTIFACT_DIR;
    if (configuredArtifactDirectory) {
      artifactDirectory = configuredArtifactDirectory;
      cleanupArtifactDirectory = false;
      await mkdir(artifactDirectory, { recursive: true });
    } else {
      artifactDirectory = await mkdtemp(join(tmpdir(), 'document-branding-visual-'));
      cleanupArtifactDirectory = true;
    }

    externalRequests = [];
    const browser = await browserService.getBrowser();
    const fontManifest = await readFile(FONT_MANIFEST_PATH);
    manifest = {
      renderer_version: RENDERER_VERSION,
      font_id: FONT_ID,
      font_manifest_sha256: createHash('sha256').update(fontManifest).digest('hex'),
      chromium_version: browser.version(),
      generated_at_utc: new Date().toISOString(),
      approvals: {
        status: 'PENDING',
        reviewer: null,
        reviewed_at: null,
        evidence_url: null,
      },
      fixtures: [],
    };
    await writeFile(
      join(artifactDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

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
    if (cleanupArtifactDirectory && artifactDirectory) {
      await rm(artifactDirectory, { recursive: true, force: true });
    }
  });

  it('branded rendering never requests external resources', async () => {
    externalRequests.length = 0;
    const fixture = FIXTURES.find((candidate) => candidate.branded);
    if (!fixture) throw new Error('Expected at least one branded visual fixture.');
    const snapshot = createSnapshot(fixture);
    snapshot.branding!.tokens.header_text = 'https://attacker.example/logo.png';
    const logoPng = fixture.logo
      ? await createTransparentLogoPng(fixture.logo)
      : undefined;
    if (snapshot.branding?.logo && logoPng) {
      snapshot.branding.logo.sha256 = createHash('sha256').update(logoPng).digest('hex');
    }

    await renderer.render(snapshot, logoPng ? { logoPng } : undefined);

    expect(externalRequests).toEqual([]);
  });

  it.each(FIXTURES)('$id preserves protected content and exact totals', async (fixture) => {
    externalRequests.length = 0;
    const snapshot = createSnapshot(fixture);
    const logoPng = fixture.logo
      ? await createTransparentLogoPng(fixture.logo)
      : undefined;
    if (snapshot.branding?.logo && logoPng) {
      snapshot.branding.logo.sha256 = createHash('sha256').update(logoPng).digest('hex');
    }

    const pdfBytes = await renderer.render(snapshot, logoPng ? { logoPng } : undefined);
    const invoiceNumber = invoiceNumberFor(fixture);
    const artifactPath = join(artifactDirectory, `${fixture.id}.pdf`);
    await writeFile(artifactPath, pdfBytes);
    const { pageCount, text: extractedText } = await readPdfText(pdfBytes);
    const normalizedText = extractedText.replace(/\s+/g, ' ').trim();
    manifest.fixtures.push({
      fixture_id: fixture.id,
      country: fixture.country,
      tax_profile: fixture.taxProfile,
      header_band: fixture.headerBand,
      footer_band: fixture.footerBand,
      logo_dimensions: fixture.logo,
      page_count: pageCount,
      pdf_sha256: createHash('sha256').update(pdfBytes).digest('hex'),
    });
    await writeFile(
      join(artifactDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    expect(normalizedText).toContain('Werkstatt GmbH');
    expect(normalizedText).toContain('Kunden AG');
    expect(normalizedText).toContain(invoiceNumber);
    expect(normalizedText).toContain('Zahlbar innerhalb von 14 Tagen ohne Abzug.');
    expect(normalizedText).toContain('Hauptstraße 1');
    expect(normalizedText).toContain(
      fixture.country === 'AT' ? 'UID: ATU12345678' : 'USt-IdNr.: DE123456789',
    );
    expect(normalizedText).toContain('IBAN: DE89370400440532013000');
    expect(normalizedText).toContain('Fixture line 001');
    expect(normalizedText).toContain(
      `Fixture line ${String(fixture.itemCount).padStart(3, '0')}`,
    );
    if (fixture.longLegalFields) {
      expect(normalizedText).toContain(LONG_COURT_TEXT);
      expect(normalizedText).toContain(LONG_REPRESENTATIVE_TEXT);
    }
    if (fixture.decorativeTextLength === 120) {
      expect(normalizedText).toContain(LONG_HEADER_VISIBLE_PREFIX);
      expect(normalizedText).toContain(LONG_FOOTER_VISIBLE_PREFIX);
      expect(normalizedText).toContain('…');
    }

    if (fixture.taxProfile === 'margin') {
      expect(normalizedText).toContain(MARGIN_SCHEME_DE_NOTE);
      expect(normalizedText).not.toContain(MARGIN_SCHEME_AT_NOTE);
      expect(normalizedText).toContain(`Brutto: ${snapshot.total_gross}`);
      expect(normalizedText).not.toContain('Umsatzsteuer:');
    } else {
      expect(normalizedText).toContain(`Netto: ${snapshot.total_net}`);
      expect(normalizedText).toContain(`Umsatzsteuer: ${snapshot.total_tax}`);
      expect(normalizedText).toContain(`Brutto: ${snapshot.total_gross}`);
    }

    if (fixture.itemCount === LONG_INVOICE_ITEM_COUNT) {
      expect(pageCount).toBeGreaterThanOrEqual(10);
    } else {
      expect(pageCount).toBeGreaterThanOrEqual(1);
    }
    expect(externalRequests).toEqual([]);
    await expect(readFile(artifactPath)).resolves.toEqual(pdfBytes);
  });
});
