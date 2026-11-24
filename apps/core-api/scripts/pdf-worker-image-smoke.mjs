/**
 * Playwright PDF render + golden output verification inside the pdf-worker image (CI smoke).
 * Uses the image-bundled Chromium under PLAYWRIGHT_BROWSERS_PATH and compiled dist/ renderers.
 * `pdf-worker-image-golden.json` matches the baseline captured from `origin/main` (`mcr.microsoft.com/playwright:v1.65.1-noble`).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PlaywrightBrowserService } from '../dist/common/services/playwright-browser.service.js';
import { InvoicePdfRenderer } from '../dist/invoices/invoice-pdf.renderer.js';
import { WorkshopPdfRenderer } from '../dist/workshop/workshop-pdf.renderer.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(scriptDir, 'pdf-worker-image-golden.json');
const logoPath = resolve(
  scriptDir,
  '../dist/document-branding/assets/demo-workshop-logo.png',
);

function buildInvoiceFixture(logoPng) {
  const logoSha256 = createHash('sha256').update(logoPng).digest('hex');
  return {
    schema_version: 2,
    document_kind: 'INVOICE',
    template_version: 'invoice-brand-v1',
    document_locale: 'de',
    format_locale: 'de-AT',
    translation_bundle_version: '2026-04-12.1',
    legal_text_version: null,
    id: 'inv-worker-smoke-1',
    invoice_number: 'RE-2026-0042',
    date: '2026-04-07',
    due_date: '2026-04-21',
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    notes: 'Zahlbar innerhalb von 14 Tagen.',
    tax_mode: 'STANDARD',
    branding: {
      schema_version: 1,
      profile_id: 'profile-smoke-1',
      profile_revision: 1,
      preset_id: 'standard-v1',
      renderer_version: 'invoice-brand-v1',
      font_id: 'acp-sans-v1',
      tokens: {
        primary_color: '#1E3A5F',
        secondary_color: '#475569',
        header_band: 'primary',
        footer_band: 'none',
        header_text: 'AutoCore Demo GmbH',
        footer_text: 'AutoCore Demo GmbH · UID: ATU12345678',
      },
      logo: {
        asset_id: 'demo-workshop-logo',
        bucket: 'smoke-bucket',
        key: 'smoke/logo.png',
        generation: '1',
        sha256: logoSha256,
        mime_type: 'image/png',
        width: 240,
        height: 80,
      },
      resolved_at: '2026-04-07T12:00:00.000Z',
    },
    seller: {
      name: 'AutoCore Demo GmbH',
      country_iso: 'AT',
      address_street: 'Hauptstraße 1',
      address_line2: null,
      address_zip: '1010',
      address_city: 'Wien',
      tax_number: null,
      vat_id: 'ATU12345678',
      iban: 'AT611904300234573201',
      bic: 'BKAUATWW',
      bank_name: 'Demo Bank',
      email: 'office@example.com',
      phone: '+43 1 234567',
      registration_number: 'FN 123456a',
      registration_court: 'Handelsgericht Wien',
      representatives: null,
    },
    customer: {
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      phone: null,
      vat_id: null,
      address_street: 'Kundenstraße 2',
      address_city: 'Wien',
      address_zip: '1020',
      address_country: 'AT',
    },
    vehicle: {
      make: 'Demo',
      model: 'City',
      year: 2020,
      engine_code: null,
      plate: 'W-12345A',
      vin: 'VIN00000000000001',
    },
    items: [
      {
        description: 'Bremsenservice vorne',
        quantity: '1',
        unit_price: '100.00',
        tax_rate: '20',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '100.00',
        revenue_group_name: null,
      },
    ],
    tax_breakdown: [
      { rate: '20', net: '100.00', tax: '20.00', gross: '120.00' },
    ],
    snapshot_created_at: '2026-04-07T12:00:00.000Z',
  };
}

function buildWorkshopOrderFixture() {
  return {
    id: 'order-worker-smoke-1',
    order_number: 'WO-PDF-42',
    status: 'INTAKE',
    odometer: 45000,
    fuel_level: 80,
    reported_issue: 'Quietschende Bremsen',
    notes: 'Interner Hinweis',
    customer: {
      type: 'PRIVATE',
      first_name: 'Test',
      last_name: 'Fahrer',
      company_name: null,
      phone: '+431234567',
      email: 'driver@example.com',
      address_zip: '1010',
      address_city: 'Wien',
      preferred_language: 'de',
    },
    vehicle: {
      make: 'VW',
      model: 'Golf',
      year: 2020,
      vin: 'VIN-FIXTURE-001',
      plate: 'W-4242',
    },
    tasks: [
      {
        title: 'Bremsenprüfung',
        mechanic_notes: 'Beläge prüfen',
        line_items: [
          {
            type: 'PART',
            item_no: 'PAD-01',
            description: 'Bremsbelagsatz',
            quantity: '1',
          },
        ],
      },
    ],
    check_in: null,
  };
}

async function extractPdfGoldenSummary(pdfBuffer) {
  const header = Buffer.from(pdfBuffer).subarray(0, 5).toString('ascii');
  if (header !== '%PDF-') {
    throw new Error(`Expected PDF header, got ${JSON.stringify(header)}`);
  }

  const loadingTask = getDocument({
    data: Uint8Array.from(pdfBuffer),
    disableFontFace: true,
    stopAtErrors: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  const doc = await loadingTask.promise;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push({
        width: Math.round(viewport.width * 100) / 100,
        height: Math.round(viewport.height * 100) / 100,
        text,
      });
    }
    return {
      numPages: doc.numPages,
      pages,
    };
  } finally {
    await loadingTask.destroy();
  }
}

const updateGolden = process.argv.includes('--update-golden');
const logoPng = readFileSync(logoPath);
const browserService = new PlaywrightBrowserService();

try {
  const invoiceRenderer = new InvoicePdfRenderer(browserService);
  const workshopRenderer = new WorkshopPdfRenderer(browserService);

  const invoicePdf = await invoiceRenderer.render(buildInvoiceFixture(logoPng), {
    logoPng,
  });
  const workshopPdf = await workshopRenderer.render(
    buildWorkshopOrderFixture(),
    { documentLocale: 'de', renderMode: 'legacy' },
  );

  const actual = {
    invoice: await extractPdfGoldenSummary(invoicePdf),
    workshopOrder: await extractPdfGoldenSummary(workshopPdf),
  };

  if (updateGolden) {
    writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
    console.log(`pdf-worker-image-smoke: updated golden at ${goldenPath}`);
  } else {
    const expected = JSON.parse(readFileSync(goldenPath, 'utf8'));
    assert.deepStrictEqual(actual, expected);
    console.log(
      `pdf-worker-image-smoke: ok (invoice ${invoicePdf.length} bytes / ${actual.invoice.numPages} page(s), workshopOrder ${workshopPdf.length} bytes / ${actual.workshopOrder.numPages} page(s))`,
    );
  }
} finally {
  await browserService.onModuleDestroy();
}
