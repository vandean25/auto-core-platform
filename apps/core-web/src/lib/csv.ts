import { triggerBlobDownload } from '@/lib/download'

/**
 * Client-side CSV helpers shared by the DataTable "Export CSV" action and the report pages.
 *
 * Quoting follows RFC 4180: a field that contains the separator, a double quote or a line break is
 * wrapped in double quotes with embedded quotes doubled, and records end with CRLF. Fields are
 * joined with `;` by default, the separator the German-locale exports in this app already use, so
 * they open in Excel with one column per field.
 *
 * Cells that spreadsheet software would read as a formula are neutralised with a leading
 * apostrophe (the OWASP CSV-injection mitigation).
 */

const CSV_DEFAULT_SEPARATOR = ';'
const CSV_RECORD_SEPARATOR = '\r\n'
// Byte-order mark, so Excel reads UTF-8 umlauts correctly.
const CSV_BOM = '﻿'

const FORMULA_TRIGGERS = '=+-@'
// Plain numbers with a German decimal comma (for example "-12,50") cannot start a formula.
const LOCALIZED_NUMBER = /^-?\d+(?:,\d+)?$/

function startsWithFormula(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    // Spreadsheets ignore leading whitespace, control characters and the byte-order mark.
    const isIgnoredLeadingCharacter =
      /\s/.test(character) || code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0xfeff
    if (isIgnoredLeadingCharacter) continue
    return FORMULA_TRIGGERS.includes(character)
  }
  return false
}

function neutraliseFormula(value: string): string {
  return !LOCALIZED_NUMBER.test(value) && startsWithFormula(value) ? `'${value}` : value
}

export function escapeCsvField(value: string, separator = CSV_DEFAULT_SEPARATOR): string {
  const safeValue = neutraliseFormula(value)
  const needsQuotes = safeValue.includes(separator) || /["\r\n]/.test(safeValue)
  return needsQuotes ? `"${safeValue.replaceAll('"', '""')}"` : safeValue
}

export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function serializeCsv(rows: readonly (readonly unknown[])[], separator = CSV_DEFAULT_SEPARATOR): string {
  return rows
    .map((row) => row.map((cell) => escapeCsvField(cellToText(cell), separator)).join(separator))
    .join(CSV_RECORD_SEPARATOR)
}

export function csvBlob(content: string): Blob {
  return new Blob([CSV_BOM, content], { type: 'text/csv;charset=utf-8' })
}

export function downloadCsv(content: string, fileName: string): void {
  triggerBlobDownload(csvBlob(content), fileName)
}
