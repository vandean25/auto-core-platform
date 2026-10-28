import { describe, expect, it } from 'vitest'

import { parseImportCsvFile } from './parse-import-csv-client'

function csvFile(text: string): File {
  const file = new File([text], 'errors.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(text).buffer,
  })
  return file
}

describe('parseImportCsvFile', () => {
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
