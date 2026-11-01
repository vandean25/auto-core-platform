import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getErrorMessage } from '@/lib/error-utils'

import deErrors from '../../../../locales/de/errors.json'

import { fetchWithAuth } from './client'
import {
  downloadImportErrorRowsCsv,
  finalizeDirectImportUpload,
  importKeys,
  startDirectImportUpload,
  useApplyImportJob,
  useCreateImportSource,
  useDeleteImportSource,
  useImportDryRun,
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

  it('does not carry the raw backend message when download fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Download unavailable' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(downloadImportErrorRowsCsv('job-1')).rejects.toThrow('Failed to download error rows')
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

describe('import wire codes', () => {
  function rejectOnceWith(status: number, code: string, message: string) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: status, code, message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }

  function renderWithQueryClient<T>(hook: () => T) {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)
    return renderHook(hook, { wrapper })
  }

  it('keeps the duplicate source code so the settings panel shows the German copy', async () => {
    rejectOnceWith(
      409,
      'IMPORT_SOURCE_ALREADY_EXISTS',
      "Import source with key 'legacy_dms' already exists",
    )
    const { result } = renderWithQueryClient(() => useCreateImportSource())

    const error = await result.current
      .mutateAsync({ key: 'legacy_dms', label: 'Legacy DMS' })
      .catch((caught: unknown) => caught)

    expect((error as Error).message).not.toContain("Import source with key 'legacy_dms' already exists")
    expect((error as { response?: { data?: { message?: unknown } } }).response?.data?.message).toBeUndefined()
    expect(getErrorMessage(error, 'unused fallback')).toBe(
      deErrors.codes.IMPORT_SOURCE_ALREADY_EXISTS,
    )
  })

  it('keeps the unknown source code so the upload dialog shows the German copy', async () => {
    rejectOnceWith(400, 'IMPORT_UNKNOWN_SOURCE', "Unknown import source: 'nope'")
    const { result } = renderWithQueryClient(() => useImportDryRun())

    const error = await result.current
      .mutateAsync({
        file: new File(['Kunden-Nr\n1'], 'customers.csv', { type: 'text/csv' }),
        entityType: 'CUSTOMER',
        sourceSystem: 'nope',
        mapping: { external_id: 'Kunden-Nr' },
        options: {},
      })
      .catch((caught: unknown) => caught)

    expect(getErrorMessage(error, 'unused fallback')).toBe(
      deErrors.codes.IMPORT_UNKNOWN_SOURCE,
    )
  })

  it('keeps the oversize code so the upload dialog shows the German copy', async () => {
    rejectOnceWith(413, 'IMPORT_DIRECT_UPLOAD_TOO_LARGE', 'Import file exceeds the size limit')

    const error = await startDirectImportUpload({
      fileName: 'customers.csv',
      size: 1024,
      contentType: 'text/csv',
    }).catch((caught: unknown) => caught)

    expect(getErrorMessage(error, 'unused fallback')).toBe(
      deErrors.codes.IMPORT_DIRECT_UPLOAD_TOO_LARGE,
    )
  })

  it('keeps the content type code so the upload dialog shows the German copy', async () => {
    rejectOnceWith(400, 'IMPORT_DIRECT_UPLOAD_CONTENT_TYPE', 'Unsupported content type')

    const error = await startDirectImportUpload({
      fileName: 'customers.csv',
      size: 1024,
      contentType: 'application/pdf',
    }).catch((caught: unknown) => caught)

    expect(getErrorMessage(error, 'unused fallback')).toBe(
      deErrors.codes.IMPORT_DIRECT_UPLOAD_CONTENT_TYPE,
    )
  })

  it('keeps the invalid upload code so the upload dialog shows the German copy', async () => {
    rejectOnceWith(400, 'IMPORT_DIRECT_UPLOAD_INVALID', 'File name must end with .csv')

    const error = await startDirectImportUpload({
      fileName: 'customers.xlsx',
      size: 1024,
      contentType: 'text/csv',
    }).catch((caught: unknown) => caught)

    expect(getErrorMessage(error, 'unused fallback')).toBe(
      deErrors.codes.IMPORT_DIRECT_UPLOAD_INVALID,
    )
  })

  it('keeps the missing upload code so finalize shows the German copy', async () => {
    rejectOnceWith(404, 'IMPORT_DIRECT_UPLOAD_NOT_FOUND', 'Direct import upload not found')

    const error = await finalizeDirectImportUpload('upload-1', {
      fileName: 'customers.csv',
      size: 1024,
      entityType: 'CUSTOMER',
      sourceSystem: 'legacy_dms',
      mapping: { external_id: 'Kunden-Nr' },
      options: {},
    }).catch((caught: unknown) => caught)

    expect(getErrorMessage(error, 'unused fallback')).toBe(
      deErrors.codes.IMPORT_DIRECT_UPLOAD_NOT_FOUND,
    )
  })

  it.each([
    ['IMPORT_JOB_EXPIRED', 'Import job has expired'],
    ['IMPORT_JOB_PURGED', 'Staged rows for this import job were purged'],
  ])('keeps the %s code so the job detail shows the German copy', async (code, message) => {
    rejectOnceWith(409, code, message)
    const { result } = renderWithQueryClient(() => useApplyImportJob())

    const error = await result.current
      .mutateAsync('job-1')
      .catch((caught: unknown) => caught)

    expect(getErrorMessage(error, 'unused fallback')).toBe(
      deErrors.codes[code as keyof typeof deErrors.codes],
    )
  })
})
