import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DisplayLanguage } from './display-language.js';

export type EmailLocaleBundle = Record<string, unknown>;

export function loadEmailLocaleJson(language: DisplayLanguage): EmailLocaleBundle {
  const path = resolve(process.cwd(), `../../locales/${language}/email.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as EmailLocaleBundle;
}

export function emailLocaleString(
  bundle: EmailLocaleBundle,
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
    throw new Error(`Missing email locale string at ${keyPath}`);
  }
  return value;
}
