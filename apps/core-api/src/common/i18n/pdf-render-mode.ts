import type { DisplayLanguage } from './display-language.js';
import { readDocumentSnapshotLocaleFields } from './document-snapshot-locale.js';

export type PdfRenderMode = 'legacy' | 'localized';

export type ResolvedPdfRenderMode = {
  mode: PdfRenderMode;
  documentLocale: DisplayLanguage;
};

/**
 * Legacy snapshots without frozen `document_locale` keep the pre-AUT-586 renderer
 * (German labels and historical date rules). New snapshots use localized resources.
 */
export function resolvePdfRenderMode(
  snapshot: { document_locale?: DisplayLanguage | null } | null | undefined,
): ResolvedPdfRenderMode {
  const frozen = readDocumentSnapshotLocaleFields(snapshot ?? undefined);
  if (!frozen) {
    return { mode: 'legacy', documentLocale: 'de' };
  }
  return { mode: 'localized', documentLocale: frozen.document_locale };
}
