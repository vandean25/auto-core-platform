import { IMPORT_UPLOAD_MAX_BYTES } from './import-upload-limit'

export type ParsedImportCsvPreview = {
  headers: string[]
  rows: string[][]
  delimiter: ';' | ','
}

export const IMPORT_PREVIEW_MAX_BYTES = 1024 * 1024

function firstCsvRecord(text: string): string {
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') inQuotes = !inQuotes
    else if (!inQuotes && (char === '\r' || char === '\n'))
      return text.slice(0, index)
  }
  return text
}

function restoreReportSourceHeaders(headers: string[]): string[] {
  const diagnosticStart = headers.length - (headers.at(-1) === 'note' ? 4 : 3)
  if (
    headers[0] !== 'row_no' ||
    headers.slice(diagnosticStart, diagnosticStart + 3).join(';') !==
      'error_field;error_message;error_code'
  )
    return headers
  return headers.map((header, index) =>
    index > 0 && index < diagnosticStart
      ? header.replace(/^'(?=['=+\-@\t\r])/, '')
      : header,
  )
}

function detectDelimiter(headerLine: string): ';' | ',' {
  const semicolonColumns = parseCsvRecords(headerLine, ';')[0]?.length ?? 0
  const commaColumns = parseCsvRecords(headerLine, ',')[0]?.length ?? 0
  return semicolonColumns >= commaColumns ? ';' : ','
}

function parseCsvRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          currentCell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        currentCell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === delimiter) {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1
      }
      currentRow.push(currentCell)
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow)
      }
      currentRow = []
      currentCell = ''
      continue
    }

    currentCell += char
  }

  currentRow.push(currentCell)
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow)
  }

  return rows
}

export async function parseImportCsvFile(
  file: File,
): Promise<ParsedImportCsvPreview> {
  const truncated = file.size > IMPORT_UPLOAD_MAX_BYTES
  const buffer = truncated
    ? await file.slice(0, IMPORT_PREVIEW_MAX_BYTES).arrayBuffer()
    : await file.arrayBuffer()
  const text = new TextDecoder('utf-8', { fatal: false })
    .decode(buffer)
    .replace(/^\uFEFF/, '')
  const delimiter = detectDelimiter(firstCsvRecord(text))
  const records = parseCsvRecords(text, delimiter)
  const headers = restoreReportSourceHeaders(
    records[0]?.map((cell) => cell.trim()) ?? [],
  )
  const rows = records.slice(1)
  if (truncated && rows.length > 0) {
    rows.pop()
  }
  return { headers, rows, delimiter }
}

export async function sha256HexFromFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
