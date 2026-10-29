import { describe, expect, it } from 'vitest'

import { parseImportCsvFile } from './parse-import-csv-client'
import {
  constrainMappingToCsvHeaders,
  validateRequiredMappings,
} from './import-mapping-suggest'

function csvFile(text: string): File {
  const file = new File([text], 'errors.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(text).buffer,
  })
  return file
}

describe('parseImportCsvFile', () => {
  it.each(['', ';note'])(
    'reuses a protected required source header from a correction report with suffix %s',
    async (suffix) => {
      const parsed = await parseImportCsvFile(
        csvFile(
          `\uFEFFrow_no;'+ID;''Original;error_field;error_message;error_code${suffix}\r\n1;FIXED-1;Sample;;Check the value.;IMPORT_EXTERNAL_ID_REQUIRED${suffix ? ';Saved values' : ''}\r\n`,
        ),
      )
      const mapping = constrainMappingToCsvHeaders(
        { external_id: '+ID' },
        parsed.headers,
      )

      expect(parsed.headers).toEqual([
        'row_no',
        '+ID',
        "'Original",
        'error_field',
        'error_message',
        'error_code',
        ...(suffix ? ['note'] : []),
      ])
      expect(mapping).toEqual({ external_id: '+ID' })
      expect(
        validateRequiredMappings(mapping, [
          { key: 'external_id', required: true },
        ]),
      ).toEqual([])
    },
  )

  it('leaves apostrophes in ordinary source headers unchanged', async () => {
    const parsed = await parseImportCsvFile(csvFile("'+ID;Name\nA-1;Sample\n"))
    expect(parsed.headers).toEqual(["'+ID", 'Name'])
  })

  it.each(['\n', '\r\n'])(
    'detects comma separators after a multiline header using %j line breaks',
    async (newline) => {
      const parsed = await parseImportCsvFile(
        csvFile(
          `"Description,${newline}continued",ID${newline}Sample,A-1${newline}`,
        ),
      )
      expect(parsed.delimiter).toBe(',')
      expect(parsed.headers).toEqual([`Description,${newline}continued`, 'ID'])
      expect(parsed.rows).toEqual([['Sample', 'A-1']])
    },
  )

  it('keeps source columns available when reimporting a report with comma-heavy headers', async () => {
    const csv =
      '\uFEFFrow_no;Source ID;"Description,a,b,c,d,e,f,g";Unused;error_field;error_message;error_code\r\n' +
      '1;FIXED-1;"Sample, description";untouched;Source ID;Die externe Nummer fehlt. Bitte ergänzen Sie die Nummer in dieser Zeile.;IMPORT_EXTERNAL_ID_REQUIRED\r\n'

    const parsed = await parseImportCsvFile(csvFile(csv))

    expect(parsed.delimiter).toBe(';')
    expect(parsed.headers).toEqual([
      'row_no',
      'Source ID',
      'Description,a,b,c,d,e,f,g',
      'Unused',
      'error_field',
      'error_message',
      'error_code',
    ])
    expect(parsed.rows[0]).toEqual([
      '1',
      'FIXED-1',
      'Sample, description',
      'untouched',
      'Source ID',
      'Die externe Nummer fehlt. Bitte ergänzen Sie die Nummer in dieser Zeile.',
      'IMPORT_EXTERNAL_ID_REQUIRED',
    ])
  })

  it.each([
    [
      '"Description;a;b;c",ID\nSample,FIXED-1\n',
      ',',
      ['Description;a;b;c', 'ID'],
    ],
    [
      '"Description,a,b,c";ID\nSample;FIXED-1\n',
      ';',
      ['Description,a,b,c', 'ID'],
    ],
    [
      '"Description ""quoted"",a,b,c";ID\nSample;FIXED-1\n',
      ';',
      ['Description "quoted",a,b,c', 'ID'],
    ],
    ['Description,ID\nSample,FIXED-1\n', ',', ['Description', 'ID']],
    ['Description;ID\nSample;FIXED-1\n', ';', ['Description', 'ID']],
  ])('detects unquoted separators in %s', async (csv, delimiter, headers) => {
    const parsed = await parseImportCsvFile(csvFile(csv))

    expect(parsed.delimiter).toBe(delimiter)
    expect(parsed.headers).toEqual(headers)
    expect(parsed.rows).toEqual([['Sample', 'FIXED-1']])
  })
})
