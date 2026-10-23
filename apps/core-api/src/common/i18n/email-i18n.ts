import i18next, { type i18n, type TFunction } from 'i18next';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  DISPLAY_LANGUAGES,
  type DisplayLanguage,
} from './display-language.js';
import { resolveLocalesRoot } from './locales-root.js';

export const EMAIL_I18N_NAMESPACE = 'email';

let emailI18nInstance: i18n | null = null;

function localesRoot(): string {
  return resolveLocalesRoot(dirname(fileURLToPath(import.meta.url)));
}

function readEmailBundle(language: DisplayLanguage): Record<string, unknown> {
  const filePath = resolve(localesRoot(), language, 'email.json');
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function ensureEmailI18nInstance(): i18n {
  if (emailI18nInstance) {
    return emailI18nInstance;
  }
  const resources: Record<string, { email: Record<string, unknown> }> = {};
  for (const language of DISPLAY_LANGUAGES) {
    resources[language] = { email: readEmailBundle(language) };
  }
  emailI18nInstance = i18next.createInstance();
  void emailI18nInstance.init({
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
  return emailI18nInstance;
}

export function createEmailTranslator(
  documentLocale: DisplayLanguage,
): TFunction<typeof EMAIL_I18N_NAMESPACE> {
  return ensureEmailI18nInstance().getFixedT(
    documentLocale,
    EMAIL_I18N_NAMESPACE,
  );
}
