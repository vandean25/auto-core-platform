import { I18N_TRANSLATION_BUNDLE_VERSION } from './display-language.js';
import {
  LEGACY_I18N_TRANSLATION_BUNDLE_VERSION,
  resolveLocalizedDocumentLocale,
  snapshotUsesLocalizedPdfResources,
} from './pdf-resource-bundle.js';
import { resolvePdfRenderMode } from './pdf-render-mode.js';

describe('pdf-resource-bundle', () => {
  it('treats AUT-576 pre-resources-v1 snapshots as legacy renders', () => {
    const snapshot = {
      document_locale: 'de' as const,
      format_locale: 'de-AT' as const,
      translation_bundle_version: LEGACY_I18N_TRANSLATION_BUNDLE_VERSION,
      legal_text_version: null,
    };
    expect(snapshotUsesLocalizedPdfResources(snapshot)).toBe(false);
    expect(resolveLocalizedDocumentLocale(snapshot)).toBeNull();
    expect(resolvePdfRenderMode(snapshot)).toEqual({
      mode: 'legacy',
      documentLocale: 'de',
    });
  });

  it('enables localized renders for the current bundle version', () => {
    const snapshot = {
      document_locale: 'en' as const,
      format_locale: 'de-AT' as const,
      translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
      legal_text_version: null,
    };
    expect(snapshotUsesLocalizedPdfResources(snapshot)).toBe(true);
    expect(resolveLocalizedDocumentLocale(snapshot)).toBe('en');
    expect(resolvePdfRenderMode(snapshot)).toEqual({
      mode: 'localized',
      documentLocale: 'en',
    });
  });
});
