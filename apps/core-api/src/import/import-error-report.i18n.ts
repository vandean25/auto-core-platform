import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DisplayLanguage } from '../common/i18n/display-language.js';
import { resolveLocalesRoot } from '../common/i18n/locales-root.js';

type ImportReportCopy = {
  codes: Record<string, string>;
  unknownError: string;
  normalizedFallback: string;
};

const bundles = new Map<DisplayLanguage, ImportReportCopy>();

export function getImportReportCopy(locale: DisplayLanguage): ImportReportCopy {
  const cached = bundles.get(locale);
  if (cached) return cached;
  const root = resolveLocalesRoot(
    resolve(dirname(fileURLToPath(import.meta.url)), '../common/i18n'),
  );
  const errors = JSON.parse(
    readFileSync(resolve(root, locale, 'errors.json'), 'utf8'),
  ) as { codes: Record<string, string> };
  const settings = JSON.parse(
    readFileSync(resolve(root, locale, 'settings.json'), 'utf8'),
  ) as { dataImport: { errorReport: Omit<ImportReportCopy, 'codes'> } };
  const bundle = { codes: errors.codes, ...settings.dataImport.errorReport };
  bundles.set(locale, bundle);
  return bundle;
}
