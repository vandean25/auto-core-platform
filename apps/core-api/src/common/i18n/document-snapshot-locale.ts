import type { DisplayLanguage } from './display-language.js';
import {
  DEFAULT_FORMAT_LOCALE,
  I18N_TRANSLATION_BUNDLE_VERSION,
} from './display-language.js';

export type DocumentSnapshotLocaleFields = {
  document_locale: DisplayLanguage;
  format_locale: typeof DEFAULT_FORMAT_LOCALE;
  translation_bundle_version: string;
  legal_text_version: string | null;
};

export function buildDocumentSnapshotLocaleFields(
  documentLocale: DisplayLanguage,
  legalTextVersion?: string | null,
): DocumentSnapshotLocaleFields {
  return {
    document_locale: documentLocale,
    format_locale: DEFAULT_FORMAT_LOCALE,
    translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
    legal_text_version: legalTextVersion ?? null,
  };
}

export function readDocumentSnapshotLocaleFields(
  snapshot: Partial<DocumentSnapshotLocaleFields> | null | undefined,
): DocumentSnapshotLocaleFields | null {
  if (!snapshot?.document_locale) {
    return null;
  }
  return {
    document_locale: snapshot.document_locale,
    format_locale: snapshot.format_locale ?? DEFAULT_FORMAT_LOCALE,
    translation_bundle_version:
      snapshot.translation_bundle_version ?? I18N_TRANSLATION_BUNDLE_VERSION,
    legal_text_version: snapshot.legal_text_version ?? null,
  };
}
