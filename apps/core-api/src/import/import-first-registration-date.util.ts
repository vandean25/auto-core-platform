import type { ImportRowIssue } from './import.types.js';

const FIRST_REGISTRATION_DATE_INVALID =
  'IMPORT_FIRST_REGISTRATION_DATE_INVALID';
const FIRST_REGISTRATION_DATE_FUTURE = 'IMPORT_FIRST_REGISTRATION_DATE_FUTURE';
const FIRST_REGISTRATION_MONTH_ASSUMED =
  'IMPORT_FIRST_REGISTRATION_MONTH_ASSUMED';

const VIENNA_TIME_ZONE = 'Europe/Vienna';

export type ParsedImportFirstRegistrationDate = {
  isoDate: string | null;
  issues: ImportRowIssue[];
  warnings: ImportRowIssue[];
};

function todayInViennaYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VIENNA_TIME_ZONE,
  }).format(new Date());
}

function isValidUtcDateParts(
  year: number,
  month: number,
  day: number,
): boolean {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function finishParse(
  year: number,
  month: number,
  day: number,
  warnings: ImportRowIssue[],
): ParsedImportFirstRegistrationDate {
  if (!isValidUtcDateParts(year, month, day)) {
    return {
      isoDate: null,
      issues: [
        {
          code: FIRST_REGISTRATION_DATE_INVALID,
          message: 'first_registration_date must be a valid date',
          field: 'first_registration_date',
        },
      ],
      warnings,
    };
  }
  const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (isoDate > todayInViennaYmd()) {
    return {
      isoDate: null,
      issues: [
        {
          code: FIRST_REGISTRATION_DATE_FUTURE,
          message: 'first_registration_date cannot be in the future',
          field: 'first_registration_date',
        },
      ],
      warnings,
    };
  }
  return { isoDate, issues: [], warnings };
}

function mappedCellValue(
  record: Record<string, string>,
  mapping: Record<string, string>,
  field: string,
): string {
  const column = mapping[field];
  if (!column) {
    return '';
  }
  return record[column]?.trim() ?? '';
}

/** Reads Erstzulassung from a mapped CSV row and appends parse issues/warnings. */
export function readMappedFirstRegistrationDate(
  record: Record<string, string>,
  mapping: Record<string, string>,
  issues: ImportRowIssue[],
  warnings: ImportRowIssue[],
): string | null {
  const parsed = parseImportFirstRegistrationDate(
    mappedCellValue(record, mapping, 'first_registration_date'),
  );
  issues.push(...parsed.issues);
  warnings.push(...parsed.warnings);
  return parsed.isoDate;
}

/** Parses legacy vehicle Erstzulassung cells for CSV import (DD.MM.YYYY, ISO day, MM/YYYY). */
export function parseImportFirstRegistrationDate(
  raw: string,
): ParsedImportFirstRegistrationDate {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { isoDate: null, issues: [], warnings: [] };
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return finishParse(
      Number.parseInt(isoMatch[1], 10),
      Number.parseInt(isoMatch[2], 10),
      Number.parseInt(isoMatch[3], 10),
      [],
    );
  }

  const deMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (deMatch) {
    return finishParse(
      Number.parseInt(deMatch[3], 10),
      Number.parseInt(deMatch[2], 10),
      Number.parseInt(deMatch[1], 10),
      [],
    );
  }

  const monthYearMatch = /^(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (monthYearMatch) {
    const month = Number.parseInt(monthYearMatch[1], 10);
    const year = Number.parseInt(monthYearMatch[2], 10);
    if (month < 1 || month > 12) {
      return {
        isoDate: null,
        issues: [
          {
            code: FIRST_REGISTRATION_DATE_INVALID,
            message: 'first_registration_date must be a valid date',
            field: 'first_registration_date',
          },
        ],
        warnings: [],
      };
    }
    return finishParse(year, month, 1, [
      {
        code: FIRST_REGISTRATION_MONTH_ASSUMED,
        message:
          'first_registration_date month only; assumed first day of month',
        field: 'first_registration_date',
      },
    ]);
  }

  return {
    isoDate: null,
    issues: [
      {
        code: FIRST_REGISTRATION_DATE_INVALID,
        message: 'first_registration_date must be a valid date',
        field: 'first_registration_date',
      },
    ],
    warnings: [],
  };
}
