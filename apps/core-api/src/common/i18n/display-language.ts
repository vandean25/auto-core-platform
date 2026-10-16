import { DisplayLanguage } from '@prisma/client';

export type { DisplayLanguage };

export const DISPLAY_LANGUAGES: readonly DisplayLanguage[] = ['de', 'en'];

export const DEFAULT_DISPLAY_LANGUAGE: DisplayLanguage = 'de';

export const DEFAULT_FORMAT_LOCALE = 'de-AT';

/** Placeholder until AUT-586 publishes versioned translation bundles. */
export const I18N_TRANSLATION_BUNDLE_VERSION = 'pre-resources-v1';

export function isDisplayLanguage(value: string): value is DisplayLanguage {
  return value === 'de' || value === 'en';
}
