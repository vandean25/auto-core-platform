import { describe, expect, it, vi } from 'vitest'
import { triggerBlobDownload } from '@/lib/download'
import { cellToText, csvBlob, downloadCsv, escapeCsvField, serializeCsv } from './csv'

vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))

describe('escapeCsvField', () => {
  it('leaves plain text unquoted', () => {
    expect(escapeCsvField('Müller')).toBe('Müller')
    expect(escapeCsvField('')).toBe('')
  })

  it('wraps fields that contain the separator in double quotes', () => {
    expect(escapeCsvField('Filter; Öl')).toBe('"Filter; Öl"')
  })

  it('doubles embedded double quotes and wraps the field (RFC 4180)', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('wraps fields that contain a line break (RFC 4180)', () => {
    expect(escapeCsvField('line 1\nline 2')).toBe('"line 1\nline 2"')
    expect(escapeCsvField('line 1\r\nline 2')).toBe('"line 1\r\nline 2"')
  })

  it('does not treat commas as special in the default German separator', () => {
    expect(escapeCsvField('Wien, Austria')).toBe('Wien, Austria')
  })

  it('quotes on the separator it is given', () => {
    expect(escapeCsvField('a,b', ',')).toBe('"a,b"')
    expect(escapeCsvField('a;b', ',')).toBe('a;b')
  })

  it.each(['=1+1', '+49 123', '-1+1', '@SUM(A1:A2)'])('neutralises a leading formula trigger in %s', (value) => {
    expect(escapeCsvField(value)).toBe(`'${value}`)
  })

  it('neutralises formulas hidden behind leading whitespace, tabs, control characters or a byte-order mark', () => {
    expect(escapeCsvField('  =1+1')).toBe("'  =1+1")
    expect(escapeCsvField('\t=1+1')).toBe("'\t=1+1")
    expect(escapeCsvField('\u0007=1+1')).toBe("'\u0007=1+1")
    expect(escapeCsvField('﻿=1+1')).toBe("'﻿=1+1")
  })

  it('quotes a neutralised formula that also contains a double quote', () => {
    expect(escapeCsvField('\t=HYPERLINK("https://example.test")')).toBe(
      `"'\t=HYPERLINK(""https://example.test"")"`,
    )
  })

  it('does not neutralise triggers that are not at the start of the value', () => {
    expect(escapeCsvField('a=b')).toBe('a=b')
    expect(escapeCsvField('Rechnung +5')).toBe('Rechnung +5')
  })

  it('keeps localized amounts as plain numbers', () => {
    expect(escapeCsvField('-12,50')).toBe('-12,50')
    expect(escapeCsvField('-500,00')).toBe('-500,00')
    expect(escapeCsvField('7')).toBe('7')
  })

  it('still neutralises decimal-point negatives', () => {
    expect(escapeCsvField('-5.00')).toBe("'-5.00")
  })
})

describe('serializeCsv', () => {
  it('joins fields with a semicolon and records with CRLF, without a trailing line break', () => {
    expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a;b\r\nc;d')
  })

  it('writes empty fields for null and undefined and stringifies numbers and booleans', () => {
    expect(serializeCsv([[null, undefined, 12, true, false]])).toBe(';;12;true;false')
  })

  it('applies quoting and the formula guard to every cell', () => {
    expect(serializeCsv([['=x', 'Filter; Öl']])).toBe(`'=x;"Filter; Öl"`)
  })

  it('uses the separator it is given', () => {
    expect(serializeCsv([['a', 'b']], ',')).toBe('a,b')
  })
})

describe('cellToText', () => {
  it('formats valid dates as ISO strings and invalid dates as empty', () => {
    expect(cellToText(new Date('2026-10-05T00:00:00.000Z'))).toBe('2026-10-05T00:00:00.000Z')
    expect(cellToText(new Date('not a date'))).toBe('')
  })

  it('serialises objects as JSON instead of [object Object]', () => {
    expect(cellToText({ name: 'A' })).toBe('{"name":"A"}')
  })

  it('treats null and undefined as empty', () => {
    expect(cellToText(null)).toBe('')
    expect(cellToText(undefined)).toBe('')
  })
})

describe('csvBlob and downloadCsv', () => {
  it('prefixes a UTF-8 byte-order mark and declares UTF-8 CSV', async () => {
    const blob = csvBlob('a;b')
    const bytes = new Uint8Array(await blob.arrayBuffer())

    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('a;b')
  })

  it('hands the blob and file name to the shared download helper', () => {
    downloadCsv('a;b', 'export.csv')

    expect(triggerBlobDownload).toHaveBeenCalledWith(expect.any(Blob), 'export.csv')
  })
})
