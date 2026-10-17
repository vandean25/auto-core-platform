import { extractVisibleTextFromHtml } from '../common/pdf/pdf-html-text.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import { I18N_TRANSLATION_BUNDLE_VERSION } from '../common/i18n/display-language.js';
import { buildWorkshopEstimateHtmlDocument } from './workshop-estimate-pdf.layout.js';
import { buildEstimateSnapshot } from './workshop-estimate.spec.support.js';

describe('workshop-estimate-pdf.layout golden text', () => {
  const FONT_CSS = '';

  it('renders German title for de snapshots', () => {
    const snapshot = buildEstimateSnapshot({ documentLocale: 'de' });
    const html = buildWorkshopEstimateHtmlDocument(snapshot, FONT_CSS, escapeHtml);
    const text = extractVisibleTextFromHtml(html);
    expect(text).toContain('Kostenvoranschlag');
  });

  it('renders English title and legal notice for en snapshots', () => {
    const snapshot = {
      ...buildEstimateSnapshot({ documentLocale: 'en' }),
      document_locale: 'en' as const,
      format_locale: 'de-AT' as const,
      translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
      legal_text_version: null,
    };
    const html = buildWorkshopEstimateHtmlDocument(snapshot, FONT_CSS, escapeHtml);
    const text = extractVisibleTextFromHtml(html);
    expect(text).toContain('Cost estimate');
    expect(text).toContain(
      'The German version of the legal texts is authoritative',
    );
  });
});
