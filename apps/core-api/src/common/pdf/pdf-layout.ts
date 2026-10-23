import {
  readDocumentSnapshotLocaleFields,
  type DocumentSnapshotLocaleReader,
} from '../i18n/document-snapshot-locale.js';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  type DisplayLanguage,
} from '../i18n/display-language.js';
import { createPdfTranslator } from '../i18n/pdf-i18n.js';
import { resolveLocalizedDocumentLocale } from '../i18n/pdf-resource-bundle.js';

export type EscapeHtml = (value: unknown) => string;

const PDF_FOOTER_PAGE_PLACEHOLDER = '\u0000PAGE\u0000';
const PDF_FOOTER_TOTAL_PLACEHOLDER = '\u0000TOTAL\u0000';

export function resolvePdfFooterDocumentLocale(
  snapshot: DocumentSnapshotLocaleReader | null | undefined,
): DisplayLanguage {
  return (
    resolveLocalizedDocumentLocale(snapshot) ??
    readDocumentSnapshotLocaleFields(snapshot)?.document_locale ??
    DEFAULT_DISPLAY_LANGUAGE
  );
}

export function buildPdfFooterPageNumbersHtml(
  documentLocale: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
): string {
  const t = createPdfTranslator(documentLocale);
  const labeled = t('layout.pageOfTotal', {
    page: PDF_FOOTER_PAGE_PLACEHOLDER,
    total: PDF_FOOTER_TOTAL_PLACEHOLDER,
  });
  return labeled
    .replaceAll(
      PDF_FOOTER_PAGE_PLACEHOLDER,
      '<span class="pageNumber"></span>',
    )
    .replaceAll(
      PDF_FOOTER_TOTAL_PLACEHOLDER,
      '<span class="totalPages"></span>',
    );
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    str = String(value);
  } else if (value instanceof Date) {
    str = value.toISOString();
  } else {
    str = JSON.stringify(value) ?? '';
  }

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const buildPdfTableStyles = (): string => `
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { text-align: left; border-bottom: 1px solid #d1d5db; }
  td { border-bottom: 1px solid #f3f4f6; }
`;

export const buildBasePdfStyles = (): string => `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    font-size: 12px;
    color: #111827;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .section { margin-bottom: 18px; }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #374151;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 6px;
    margin-bottom: 10px;
  }
  ${buildPdfTableStyles()}
`;

export function buildPdfFooterTemplate(
  titleHtml: string,
  documentLocale: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
): string {
  const pageNumbersHtml = buildPdfFooterPageNumbersHtml(documentLocale);
  return `
      <div style="
        width: 100%;
        padding: 0 50px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 9px;
        color: #6b7280;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <span>${titleHtml}</span>
        <span>${pageNumbersHtml}</span>
      </div>
    `;
}
