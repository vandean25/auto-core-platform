import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from './client'
import {
  downloadImportErrorRowsCsv,
  importKeys,
  useDeleteImportSource,
  type ImportSourceListResponse,
} from './imports'

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

describe('useDeleteImportSource', () => {
  it('removes the deleted source from the cache immediately upon successful deletion', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const queryClient = new QueryClient()
    const initialSources: ImportSourceListResponse = {
      data: [
        {
          id: 'src-1',
          key: 'legacy_dms',
          label: 'Legacy DMS',
          is_default: true,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'src-2',
          key: 'incadea',
          label: 'Incadea',
          is_default: false,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    }
    queryClient.setQueryData(importKeys.sources(), initialSources)

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useDeleteImportSource(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('src-1')
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/imports/sources/src-1', {
      method: 'DELETE',
    })

    const cached = queryClient.getQueryData<ImportSourceListResponse>(importKeys.sources())
    expect(cached?.data).toEqual([initialSources.data[1]])
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: importKeys.sources() })
  })
})
