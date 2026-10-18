import i18next, { type TFunction } from 'i18next';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  DISPLAY_LANGUAGES,
  type DisplayLanguage,
} from './display-language.js';

export const EMAIL_I18N_NAMESPACE = 'email';

let initialized = false;

function localesRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const bundled = resolve(moduleDir, '../../../locales');
  if (existsSync(bundled)) {
    return bundled;
  }
  return resolve(moduleDir, '../../../../../locales');
}

function readEmailBundle(language: DisplayLanguage): Record<string, unknown> {
  const filePath = resolve(localesRoot(), language, 'email.json');
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

export function ensureEmailI18nInitialized(): void {
  if (initialized) {
    return;
  }
  const resources: Record<string, { email: Record<string, unknown> }> = {};
  for (const language of DISPLAY_LANGUAGES) {
    resources[language] = { email: readEmailBundle(language) };
  }
  void i18next.init({
    lng: DEFAULT_DISPLAY_LANGUAGE,
    fallbackLng: DEFAULT_DISPLAY_LANGUAGE,
    supportedLngs: [...DISPLAY_LANGUAGES],
    ns: [EMAIL_I18N_NAMESPACE],
    defaultNS: EMAIL_I18N_NAMESPACE,
    resources,
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
  initialized = true;
}

export function createEmailTranslator(
  documentLocale: DisplayLanguage,
): TFunction<typeof EMAIL_I18N_NAMESPACE> {
  ensureEmailI18nInitialized();
  return i18next.getFixedT(documentLocale, EMAIL_I18N_NAMESPACE);
}
