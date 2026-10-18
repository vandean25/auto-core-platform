import type { DisplayLanguage } from './display-language.js';
import { resolveLocalizedDocumentLocale } from './pdf-resource-bundle.js';
import type { DocumentSnapshotLocaleReader } from './document-snapshot-locale.js';

export type PdfRenderMode = 'legacy' | 'localized';

export type ResolvedPdfRenderMode = {
  mode: PdfRenderMode;
  documentLocale: DisplayLanguage;
};

/**
 * Legacy path: no frozen locale, or AUT-576 placeholders (pre-resources-v1)
 * that were never rendered with locales pdf.json. Localized path requires
 * the current I18N_TRANSLATION_BUNDLE_VERSION on the snapshot.
 */
export function resolvePdfRenderMode(
  snapshot: DocumentSnapshotLocaleReader | null | undefined,
): ResolvedPdfRenderMode {
  const locale = resolveLocalizedDocumentLocale(snapshot);
  if (!locale) {
    return { mode: 'legacy', documentLocale: 'de' };
  }
  return { mode: 'localized', documentLocale: locale };
}
