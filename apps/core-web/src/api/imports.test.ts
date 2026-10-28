import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from './client'
import { downloadImportErrorRowsCsv } from './imports'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

const fetchMock = vi.mocked(fetchWithAuth)

beforeEach(() => {
  fetchMock.mockReset()
})

describe('downloadImportErrorRowsCsv', () => {
  it.each([
    ['de', 'de'],
    ['en', 'en'],
    ['de-AT', 'de'],
    ['en-US', 'en'],
    ['EN-us', 'en'],
    [' en-US ', 'en'],
    ['fr', 'de'],
    ['english', 'de'],
    ['', 'de'],
    [undefined, 'de'],
  ])('sends supported Accept-Language %s as %s', async (language, expectedLanguage) => {
    fetchMock.mockResolvedValueOnce(new Response('row_no;Source ID;Original name;error_field;error_message;error_code\n2;EXT-1;Pilot customer;name;Required field;IMPORT_REQUIRED_FIELD'))

    await downloadImportErrorRowsCsv('job-1', language)

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/imports/job-1/errors.csv', {
      headers: { Accept: 'text/csv', 'Accept-Language': expectedLanguage },
    })
  })

  it('returns the server CSV columns and rows unchanged', async () => {
    const csv = 'row_no;Source ID;Original name;error_field;error_message;error_code\r\n2;EXT-1;Pilotkunde;name;Pflichtfeld fehlt;IMPORT_REQUIRED_FIELD\r\n'
    fetchMock.mockResolvedValueOnce(new Response(csv, {
      headers: { 'Content-Type': 'text/csv' },
    }))

    const blob = await downloadImportErrorRowsCsv('job-1')

    expect(await blob.text()).toBe(csv)
  })

  it('preserves the server error when the download fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Download unavailable' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(downloadImportErrorRowsCsv('job-1')).rejects.toThrow('Download unavailable')
  })

  it('uses the existing fallback when the failed response is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))

    await expect(downloadImportErrorRowsCsv('job-1')).rejects.toThrow('Failed to download error rows')
  })

  it('propagates a network failure', async () => {
    const error = new Error('Network unavailable')
    fetchMock.mockRejectedValueOnce(error)

    await expect(downloadImportErrorRowsCsv('job-1')).rejects.toBe(error)
  })
})
