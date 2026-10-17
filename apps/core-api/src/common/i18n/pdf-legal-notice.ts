import type { EscapeHtml } from '../pdf/pdf-layout.js';
import type { DisplayLanguage } from './display-language.js';
import { createPdfTranslator } from './pdf-i18n.js';

export function buildAuthoritativeGermanLegalNoticeHtml(
  documentLocale: DisplayLanguage,
  escapeHtml: EscapeHtml = (value) => String(value),
): string {
  if (documentLocale === 'de') {
    return '';
  }
  const t = createPdfTranslator(documentLocale);
  const text = escapeHtml(t('legal.authoritativeGermanNotice'));
  return `<div class="legal-notice" style="margin: 16px 0; padding: 12px; border: 1px solid #e5e7eb; font-size: 10px; color: #374151;">${text}</div>`;
}
