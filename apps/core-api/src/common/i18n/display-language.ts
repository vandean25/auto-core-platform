import { DisplayLanguage } from '@prisma/client';

export type { DisplayLanguage };

export const DISPLAY_LANGUAGES: readonly DisplayLanguage[] = ['de', 'en'];

export const DEFAULT_DISPLAY_LANGUAGE: DisplayLanguage = 'de';

export const DEFAULT_FORMAT_LOCALE = 'de-AT';

/** Bumped when locales pdf.json files change and affect frozen document renders. */
export const I18N_TRANSLATION_BUNDLE_VERSION = 'pdf-resources-2026-10-v1';
