import { extractVisibleTextFromHtml } from '../common/pdf/pdf-html-text.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import { I18N_TRANSLATION_BUNDLE_VERSION } from '../common/i18n/display-language.js';
import {
  loadPdfLocaleJson,
  pdfLocaleString,
} from '../common/i18n/pdf-locale-test-helpers.js';
import { buildWorkshopEstimateHtmlDocument } from './workshop-estimate-pdf.layout.js';
import { buildEstimateSnapshot } from './workshop-estimate.spec.support.js';

describe('workshop-estimate-pdf.layout golden text', () => {
  const FONT_CSS = '';
  const dePdf = loadPdfLocaleJson('de');
  const enPdf = loadPdfLocaleJson('en');

  it('renders German presentation labels from pdf.json for de snapshots', () => {
    const snapshot = buildEstimateSnapshot({ documentLocale: 'de' });
    const text = extractVisibleTextFromHtml(
      buildWorkshopEstimateHtmlDocument(snapshot, FONT_CSS, escapeHtml),
    );
    expect(text).toContain(pdfLocaleString(dePdf, 'estimate.title'));
    expect(text).toContain(pdfLocaleString(dePdf, 'estimate.dateLabel'));
    expect(text).toContain(pdfLocaleString(dePdf, 'estimate.validUntilLabel'));
    expect(text).toContain(pdfLocaleString(dePdf, 'estimate.providerLabel'));
    expect(text).toContain(pdfLocaleString(dePdf, 'estimate.customerLabel'));
    expect(text).toContain(pdfLocaleString(dePdf, 'estimate.lineDescriptionHeader'));
  });

  it('renders English presentation labels from pdf.json for en snapshots', () => {
    const snapshot = {
      ...buildEstimateSnapshot({ documentLocale: 'en' }),
      document_locale: 'en' as const,
      format_locale: 'de-AT' as const,
      translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
      legal_text_version: null,
    };
    const text = extractVisibleTextFromHtml(
      buildWorkshopEstimateHtmlDocument(snapshot, FONT_CSS, escapeHtml),
    );
    expect(text).toContain(pdfLocaleString(enPdf, 'estimate.title'));
    expect(text).toContain(pdfLocaleString(enPdf, 'estimate.dateLabel'));
    expect(text).toContain(pdfLocaleString(enPdf, 'estimate.providerLabel'));
    expect(text).toContain(pdfLocaleString(enPdf, 'estimate.customerLabel'));
    expect(text).toContain(pdfLocaleString(enPdf, 'estimate.lineDescriptionHeader'));
    expect(text).toContain(pdfLocaleString(enPdf, 'legal.authoritativeGermanNotice'));
  });
});
