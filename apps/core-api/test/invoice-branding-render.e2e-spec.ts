import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaywrightBrowserService } from '../src/common/services/playwright-browser.service.js';
import { toRenderableCreditNoteSnapshot } from '../src/credit-notes/credit-note-snapshot-render.adapter.js';
import { InvoicePdfRenderer } from '../src/invoices/invoice-pdf.renderer.js';
import type { InvoiceSnapshot } from '../src/invoices/invoice-snapshot.js';
import {
  createDocumentBrandingVisualFixtures,
  createTransparentLogoPng,
  type VisualFixture,
} from '../scripts/document-branding-visual-fixtures.js';
import {
  lettersAndDigits,
  normalizePdfText,
  readPdfText,
} from './pdf-text-test-utils.js';

const LONG_INVOICE_ITEM_COUNT = 100;
const LONG_COURT_TEXT = `Handelsgericht Wien ${'mit ergänzenden Firmenbuchangaben '.repeat(8)}`;
const LONG_REPRESENTATIVE_TEXT = `Max Mustermann ${'bevollmächtigter Vertreter '.repeat(12)}`;
const MARGIN_SCHEME_DE_NOTE =
  'Gebrauchtgegenstände/Sonderregelung – Differenzbesteuerung gemäß § 25a UStG.';
const MARGIN_SCHEME_AT_NOTE =
  'Differenzbesteuerung gemäß § 24 UStG 1994 (Gebrauchtgegenstände).';
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

/**
 * An amount as the rendered text layer prints it: euro sign, Austrian separators, and the
 * non-breaking space after the sign collapsed to the plain space pdf.js reports.
 */
function austriaAmount(value: string): string {
  const parts = new Intl.NumberFormat('de-AT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(Number(value));
  return parts
    .map((part) => (part.type === 'group' ? '.' : part.value))
    .join('')
    .replace('\u00A0', ' ');
}

type VisualArtifactEntry = {
  fixture_id: string;
  country: VisualFixture['country'];
  tax_profile: VisualFixture['taxProfile'];
  document_kind: NonNullable<VisualFixture['documentKind']>;
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

function documentNumberFor(fixture: VisualFixture): string {
  if (fixture.documentKind === 'CREDIT_NOTE') {
    return `CN-${fixture.country}-${fixture.id.toUpperCase()}`;
  }
  return invoiceNumberFor(fixture);
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

/**
 * Full-document Stornorechnung of the fixture invoice, mapped through the same adapter the credit-note
 * PDF path uses. Credit notes are unbranded, so the fixture branding is not carried over.
 */
function createCreditNoteRenderable(fixture: VisualFixture): InvoiceSnapshot {
  const original = createSnapshot({ ...fixture, documentKind: 'INVOICE' });
  const creditNote = toRenderableCreditNoteSnapshot(
    {
      ...original,
      date: '2026-10-12',
      due_date: '2026-10-12',
      document_kind: 'CREDIT_NOTE',
      credit_title: 'Stornorechnung',
      original_document: {
        id: 'invoice-RE-2026-0099',
        number: 'RE-2026-0099',
        date: '2026-09-20',
        reason: 'Visual fixture full credit',
        snapshot_version: 2,
      },
      items: original.items.map((item) => ({
        ...item,
        net: item.line_total,
        tax: '0.00',
        gross: item.line_total,
      })),
    },
    documentNumberFor(fixture),
    `credit-${fixture.id}`,
  );
  if (!creditNote) {
    throw new Error('Expected a renderable credit note snapshot.');
  }
  return creditNote;
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
    const snapshot =
      fixture.documentKind === 'CREDIT_NOTE'
        ? createCreditNoteRenderable(fixture)
        : createSnapshot(fixture);
    const logoPng = fixture.logo
      ? await createTransparentLogoPng(fixture.logo)
      : undefined;
    if (snapshot.branding?.logo && logoPng) {
      snapshot.branding.logo.sha256 = createHash('sha256').update(logoPng).digest('hex');
    }

    const pdfBytes = await renderer.render(snapshot, logoPng ? { logoPng } : undefined);
    const documentNumber = documentNumberFor(fixture);
    const artifactPath = join(artifactDirectory, `${fixture.id}.pdf`);
    await writeFile(artifactPath, pdfBytes);
    const { pageCount, text: extractedText } = await readPdfText(pdfBytes);
    const normalizedText = normalizePdfText(extractedText);
    manifest.fixtures.push({
      fixture_id: fixture.id,
      country: fixture.country,
      tax_profile: fixture.taxProfile,
      document_kind: fixture.documentKind ?? 'INVOICE',
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

    // The unbranded Stornorechnung text layer (Inter Type 3 fonts) loses some punctuation in pdf.js,
    // e.g. the hyphens of its number and the colons of its labels, so credit notes compare letters
    // and digits only. Invoices keep exact matching.
    const comparable = (value: string) =>
      fixture.documentKind === 'CREDIT_NOTE' ? lettersAndDigits(value) : value;
    const expectText = (expected: string) =>
      expect(comparable(normalizedText)).toContain(comparable(expected));
    const expectNoText = (unexpected: string) =>
      expect(comparable(normalizedText)).not.toContain(comparable(unexpected));

    expectText('Werkstatt GmbH');
    expectText('Kunden AG');
    expectText(documentNumber);
    if (fixture.documentKind === 'CREDIT_NOTE') {
      // Credit notes do not repeat the payment terms of the original invoice.
      expectNoText('Zahlungsbedingungen:');
    } else {
      expectText('Zahlbar innerhalb von 14 Tagen ohne Abzug.');
    }
    expectText('Hauptstraße 1');
    expectText(fixture.country === 'AT' ? 'UID: ATU12345678' : 'USt-IdNr.: DE123456789');
    expectText('IBAN: DE89370400440532013000');
    expectText('Fixture line 001');
    expectText(`Fixture line ${String(fixture.itemCount).padStart(3, '0')}`);
    if (fixture.longLegalFields) {
      expectText(LONG_COURT_TEXT);
      expectText(LONG_REPRESENTATIVE_TEXT);
    }
    if (fixture.decorativeTextLength === 120) {
      expectText(LONG_HEADER_VISIBLE_PREFIX);
      expectText(LONG_FOOTER_VISIBLE_PREFIX);
      expectText('…');
    }

    if (fixture.documentKind === 'CREDIT_NOTE') {
      expectText('Stornorechnung');
    }

    if (fixture.taxProfile === 'margin') {
      const [expectedNote, otherNote] =
        fixture.country === 'AT'
          ? [MARGIN_SCHEME_AT_NOTE, MARGIN_SCHEME_DE_NOTE]
          : [MARGIN_SCHEME_DE_NOTE, MARGIN_SCHEME_AT_NOTE];
      expectText(expectedNote);
      expectNoText(otherNote);
      expectText(`Brutto: ${austriaAmount(snapshot.total_gross)}`);
      expectNoText('Umsatzsteuer:');
      expectNoText('Netto:');
    } else {
      expectText(`Netto: ${austriaAmount(snapshot.total_net)}`);
      expectText(`Umsatzsteuer: ${austriaAmount(snapshot.total_tax)}`);
      expectText(`Brutto: ${austriaAmount(snapshot.total_gross)}`);
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
