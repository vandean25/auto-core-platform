import i18next, { type TFunction } from 'i18next';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  DISPLAY_LANGUAGES,
  type DisplayLanguage,
} from './display-language.js';
import { resolveLocalesRoot } from './locales-root.js';

export const PDF_I18N_NAMESPACE = 'pdf';

let initialized = false;

function localesRoot(): string {
  return resolveLocalesRoot(dirname(fileURLToPath(import.meta.url)));
}

function readPdfBundle(language: DisplayLanguage): Record<string, unknown> {
  const filePath = resolve(localesRoot(), language, 'pdf.json');
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

export function ensurePdfI18nInitialized(): void {
  if (initialized) {
    return;
  }
  const resources: Record<string, { pdf: Record<string, unknown> }> = {};
  for (const language of DISPLAY_LANGUAGES) {
    resources[language] = { pdf: readPdfBundle(language) };
  }
  void i18next.init({
    lng: DEFAULT_DISPLAY_LANGUAGE,
    fallbackLng: DEFAULT_DISPLAY_LANGUAGE,
    supportedLngs: [...DISPLAY_LANGUAGES],
    ns: [PDF_I18N_NAMESPACE],
    defaultNS: PDF_I18N_NAMESPACE,
    resources,
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
  initialized = true;
}

export function createPdfTranslator(
  documentLocale: DisplayLanguage,
): TFunction<typeof PDF_I18N_NAMESPACE> {
  ensurePdfI18nInitialized();
  return i18next.getFixedT(documentLocale, PDF_I18N_NAMESPACE);
}
