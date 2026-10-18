import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DisplayLanguage } from './display-language.js';

export type PdfLocaleBundle = Record<string, unknown>;

export function loadPdfLocaleJson(language: DisplayLanguage): PdfLocaleBundle {
  const path = resolve(
    process.cwd(),
    `../../locales/${language}/pdf.json`,
  );
  return JSON.parse(readFileSync(path, 'utf8')) as PdfLocaleBundle;
}

export function pdfLocaleString(
  bundle: PdfLocaleBundle,
  keyPath: string,
): string {
  const value = keyPath
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      bundle,
    );
  if (typeof value !== 'string') {
    throw new Error(`Missing pdf locale string at ${keyPath}`);
  }
  return value;
}
