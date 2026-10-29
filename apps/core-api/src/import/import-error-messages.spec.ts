import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CANONICAL_ROW_ISSUE_CODES } from './canonical-csv-cell.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';

const repoRoot = resolve(process.cwd(), '../..');
const rowIssueFiles = [
  'customer-import.logic.ts',
  'vehicle-import-normalize.row.ts',
  'vehicle-import-plan.row.ts',
  'labor-operation-import.logic.ts',
  'supplier-price-list-import.logic.ts',
  'vehicle-party-import.logic.ts',
  'vehicle-due-date-import.logic.ts',
];
const literalRowCodes = rowIssueFiles.flatMap((file) => {
  const source = readFileSync(
    resolve(repoRoot, 'apps/core-api/src/import', file),
    'utf8',
  );
  return Array.from(
    source.matchAll(/\bcode\s*:\s*['"]([A-Z][A-Z0-9_]+)['"]/g),
    (match) => match[1],
  );
});
const importCodes = [
  ...new Set([
    ...Object.values(IMPORT_ERROR_CODES),
    ...Object.values(CANONICAL_ROW_ISSUE_CODES),
    ...literalRowCodes,
  ]),
].sort();

type ErrorMessages = { codes: Record<string, string> };
type SettingsMessages = {
  dataImport: { errorReport?: Record<string, string> };
};

function readLocale<T>(language: string, namespace: string): T {
  return JSON.parse(
    readFileSync(
      resolve(repoRoot, 'locales', language, `${namespace}.json`),
      'utf8',
    ),
  ) as T;
}

function expectReadableMessage(message: unknown, code: string) {
  expect(message).toEqual(expect.any(String));
  const text = message as string;
  expect(text.trim()).not.toBe('');
  expect(text).toMatch(/[a-zäöüß]+\s+[a-zäöüß]+/i);
  expect(text).not.toBe(code);
  expect(text.toLowerCase().replace(/[.!]$/, '')).not.toBe(
    code.toLowerCase().replaceAll('_', ' '),
  );
  expect(text).not.toMatch(
    /\b[a-z]+(?:_[a-z0-9]+)+\b|\b[A-Z]+(?:_[A-Z0-9]+)+\b|\bvin\b/,
  );
}

describe.each(['de', 'en'])('%s import error messages', (language) => {
  const errors = readLocale<ErrorMessages>(language, 'errors');
  const settings = readLocale<SettingsMessages>(language, 'settings');

  it.each(importCodes)('provides readable report text for %s', (code) => {
    expectReadableMessage(errors.codes[code], code);
  });

  it('tells the user how to supply a missing external ID', () => {
    expect(errors.codes.IMPORT_EXTERNAL_ID_REQUIRED).toBe(
      language === 'de'
        ? 'Die externe Nummer fehlt. Bitte ergänzen Sie die Nummer in dieser Zeile.'
        : 'The external ID is missing. Enter an ID for this row.',
    );
  });

  it('tells the user how to retry a failed row import', () => {
    expect(errors.codes.IMPORT_APPLY_FAILED).toBe(
      language === 'de'
        ? 'Die Zeile konnte nicht übernommen werden. Bitte versuchen Sie den Import erneut.'
        : 'This row could not be imported. Try importing it again.',
    );
  });

  it('provides a safe message for unknown row errors', () => {
    expect(settings.dataImport.errorReport?.unknownError).toBe(
      language === 'de'
        ? 'Die Zeile konnte nicht importiert werden. Bitte prüfen Sie die Werte und versuchen Sie es erneut.'
        : 'This row could not be imported. Check the values and try again.',
    );
  });

  it('explains when a report contains saved values instead of the original row', () => {
    expect(settings.dataImport.errorReport?.normalizedFallback).toBe(
      language === 'de'
        ? 'Die Originaldatei ist nicht mehr verfügbar. Diese Zeile enthält nur die gespeicherten, aufbereiteten Werte.'
        : 'The original file is no longer available. This row contains only the saved, normalized values.',
    );
  });
});
