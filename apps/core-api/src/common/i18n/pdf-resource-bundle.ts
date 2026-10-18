import {
  readDocumentSnapshotLocaleFields,
  type DocumentSnapshotLocaleReader,
} from './document-snapshot-locale.js';
import {
  I18N_TRANSLATION_BUNDLE_VERSION,
  type DisplayLanguage,
} from './display-language.js';

/** AUT-576 snapshots stored this before AUT-586 PDF resources shipped. */
export const LEGACY_I18N_TRANSLATION_BUNDLE_VERSION = 'pre-resources-v1';

export function snapshotUsesLocalizedPdfResources(
  snapshot: DocumentSnapshotLocaleReader | null | undefined,
): boolean {
  const frozen = readDocumentSnapshotLocaleFields(snapshot);
  if (!frozen) {
    return false;
  }
  return frozen.translation_bundle_version === I18N_TRANSLATION_BUNDLE_VERSION;
}

export function resolveLocalizedDocumentLocale(
  snapshot: DocumentSnapshotLocaleReader | null | undefined,
): DisplayLanguage | null {
  if (!snapshotUsesLocalizedPdfResources(snapshot)) {
    return null;
  }
  return readDocumentSnapshotLocaleFields(snapshot)!.document_locale;
}
