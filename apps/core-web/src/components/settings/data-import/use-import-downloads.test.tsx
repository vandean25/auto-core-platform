import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import type { ImportJob } from '@/api/imports'
import { triggerBlobDownload } from '@/lib/download'
import { changeUiLanguage } from '@/lib/i18n'
import { registerGermanUiForTests } from '@/test/german-ui'

import { useImportDownloads } from './use-import-downloads'

vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))
vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const fetchMock = vi.mocked(fetchWithAuth)
const downloadMock = vi.mocked(triggerBlobDownload)
const dryRunJob: ImportJob = {
  id: 'job-1',
  entity_type: 'CUSTOMER',
  source_system: 'legacy',
  file_name: 'customers.csv',
  file_sha256: 'file-hash',
  status: 'DRY_RUN_DONE',
  stalled: false,
  recovery_hint: null,
  mapping: {},
  options: {},
  totals: { rows: 1, create: 0, update: 0, skip: 0, error: 1 },
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  applied_at: null,
}

registerGermanUiForTests()

beforeEach(() => {
  fetchMock.mockReset()
  downloadMock.mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('useImportDownloads', () => {
  it.each(['de', 'en'] as const)('requests error rows in the active %s language', async (language) => {
    await changeUiLanguage(language)
    fetchMock.mockResolvedValueOnce(new Response('row_no;Source ID;Original name;error_field;error_message;error_code\n2;EXT-1;Pilot customer;name;Required field;IMPORT_REQUIRED_FIELD'))
    const { result } = renderHook(() => useImportDownloads({ entityType: 'CUSTOMER', dryRunJob }))

    await act(() => result.current.downloadErrorRows())

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/imports/job-1/errors.csv', {
      headers: { Accept: 'text/csv', 'Accept-Language': language },
    })
  })

  it('uses the current language after switching an already mounted wizard to English', async () => {
    fetchMock.mockResolvedValueOnce(new Response('row_no;Source ID;Original name;error_field;error_message;error_code\n2;EXT-1;Pilot customer;name;Required field;IMPORT_REQUIRED_FIELD'))
    const { result } = renderHook(() => useImportDownloads({ entityType: 'CUSTOMER', dryRunJob }))

    await act(() => changeUiLanguage('en'))
    await act(() => result.current.downloadErrorRows())

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/imports/job-1/errors.csv', {
      headers: { Accept: 'text/csv', 'Accept-Language': 'en' },
    })
  })

  it('downloads the exact server blob with the existing error filename', async () => {
    const csv = 'row_no;Source ID;Original name;error_field;error_message;error_code\r\n2;EXT-1;Pilotkunde;name;Pflichtfeld fehlt;IMPORT_REQUIRED_FIELD\r\n'
    const response = new Response(csv)
    const serverBlob = await response.clone().blob()
    vi.spyOn(response, 'blob').mockResolvedValueOnce(serverBlob)
    fetchMock.mockResolvedValueOnce(response)
    const { result } = renderHook(() => useImportDownloads({ entityType: 'CUSTOMER', dryRunJob }))

    await act(() => result.current.downloadErrorRows())

    expect(downloadMock).toHaveBeenCalledExactlyOnceWith(serverBlob, 'import-job-1-errors.csv')
    const [downloadedBlob] = downloadMock.mock.calls[0]
    expect(downloadedBlob).toBe(serverBlob)
    expect(await downloadedBlob.text()).toBe(csv)
  })

  it('makes no request when there is no dry-run job', async () => {
    const { result } = renderHook(() => useImportDownloads({ entityType: 'CUSTOMER', dryRunJob: null }))

    await act(() => result.current.downloadErrorRows())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('keeps template downloads on the existing endpoint and filename', async () => {
    fetchMock.mockResolvedValueOnce(new Response('external_id;type'))
    const { result } = renderHook(() => useImportDownloads({ entityType: 'CUSTOMER', dryRunJob: null }))

    await act(() => result.current.downloadTemplate())

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/imports/templates/CUSTOMER/csv', {
      headers: { Accept: 'text/csv' },
    })
    const [blob, fileName] = downloadMock.mock.calls[0]
    expect([await blob.text(), fileName]).toEqual(['external_id;type', 'customer-import-template.csv'])
  })

  it.each([
    ['downloadErrorRows', 'Fehler-CSV konnte nicht heruntergeladen werden'],
    ['downloadTemplate', 'Vorlage konnte nicht heruntergeladen werden'],
  ] as const)('reports the existing German error when %s fails', async (action, message) => {
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'))
    const { result } = renderHook(() => useImportDownloads({ entityType: 'CUSTOMER', dryRunJob }))

    await act(() => result.current[action]())

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(message)
    expect(downloadMock).not.toHaveBeenCalled()
  })
})
