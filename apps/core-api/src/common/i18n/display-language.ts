import { DisplayLanguage } from '@prisma/client';

export type { DisplayLanguage };

export const DISPLAY_LANGUAGES: readonly DisplayLanguage[] = ['de', 'en'];

export const DEFAULT_DISPLAY_LANGUAGE: DisplayLanguage = 'de';

export const DEFAULT_FORMAT_LOCALE = 'de-AT';

/** Separators and currency style a customer document is numbered with in its own language. */
const FORMAT_LOCALE_BY_DISPLAY_LANGUAGE: Record<DisplayLanguage, string> = {
  de: DEFAULT_FORMAT_LOCALE,
  en: 'en-GB',
};

export function formatLocaleForDisplayLanguage(
  language: DisplayLanguage,
): string {
  return FORMAT_LOCALE_BY_DISPLAY_LANGUAGE[language];
}

/** Bumped when locales pdf.json files change and affect frozen document renders. */
export const I18N_TRANSLATION_BUNDLE_VERSION = 'pdf-resources-2026-10-v2';
