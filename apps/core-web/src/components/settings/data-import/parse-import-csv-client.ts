export type ParsedImportCsvPreview = {
  headers: string[]
  rows: string[][]
  delimiter: ';' | ','
}

function detectDelimiter(headerLine: string): ';' | ',' {
  const semicolons = (headerLine.match(/;/g) ?? []).length
  const commas = (headerLine.match(/,/g) ?? []).length
  return semicolons >= commas ? ';' : ','
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

export async function parseImportCsvFile(file: File): Promise<ParsedImportCsvPreview> {
  const buffer = await file.arrayBuffer()
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer).replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/)[0] ?? ''
  const delimiter = detectDelimiter(firstLine)
  const records = parseCsvRecords(text, delimiter)
  const headers = records[0]?.map((cell) => cell.trim()) ?? []
  const rows = records.slice(1)
  return { headers, rows, delimiter }
}

export async function sha256HexFromFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
