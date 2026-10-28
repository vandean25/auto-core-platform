import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  finalizeDirectImportUpload,
  startDirectImportUpload,
  type DirectImportUploadStart,
  type ImportEntityType,
  type ImportJob,
} from '@/api/imports'

import { DEFAULT_IMPORT_OPTIONS } from './import-wizard-logic'
import { uploadImportFileDirectly } from './import-direct-upload-client'

vi.mock('@/api/imports', () => ({
  startDirectImportUpload: vi.fn(),
  finalizeDirectImportUpload: vi.fn(),
}))

const start: DirectImportUploadStart = {
  upload_id: 'upload-1',
  upload_url: 'https://storage.example/initiate',
  method: 'POST',
  headers: { 'x-goog-resumable': 'start', 'Content-Type': 'text/csv' },
  content_type: 'text/csv',
  max_bytes: 4,
  expires_at: '2026-10-28T00:00:00.000Z',
}

const dryRunJob = { id: 'job-1', status: 'DRY_RUN_DONE' } as ImportJob

function response(status: number, headers: Record<string, string> = {}) {
  return {
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Response
}

function fileOfSize(size: number): File {
  return new File([new Uint8Array(size)], 'report.csv', { type: 'text/csv' })
}

function uploadParams(file: File) {
  return {
    file,
    entityType: 'CUSTOMER' as ImportEntityType,
    sourceSystem: 'legacy',
    mapping: {},
    options: { ...DEFAULT_IMPORT_OPTIONS },
  }
}

function contentRanges(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .slice(1)
    .map((call) => (call[1] as { headers: Record<string, string> }).headers['Content-Range'])
}

describe('uploadImportFileDirectly', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(startDirectImportUpload).mockResolvedValue(start)
    vi.mocked(finalizeDirectImportUpload).mockResolvedValue(dryRunJob)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('starts the session with only the resumable and content-type headers', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(200))

    await uploadImportFileDirectly(uploadParams(fileOfSize(4)))

    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      'x-goog-resumable': 'start',
      'Content-Type': 'text/csv',
    })
  })

  it('resends from the offset the server acknowledged, not the sent end', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(308, { range: 'bytes=0-1' }))
      .mockResolvedValueOnce(response(200))

    const job = await uploadImportFileDirectly(uploadParams(fileOfSize(4)))

    expect(contentRanges(fetchMock)).toEqual(['bytes 0-3/4', 'bytes 2-3/4'])
    expect(finalizeDirectImportUpload).toHaveBeenCalledTimes(1)
    expect(job).toBe(dryRunJob)
  })

  it('restarts from the first byte when a 308 has no Range header', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(308))
      .mockResolvedValueOnce(response(200))

    await uploadImportFileDirectly(uploadParams(fileOfSize(4)))

    expect(contentRanges(fetchMock)).toEqual(['bytes 0-3/4', 'bytes 0-3/4'])
  })

  it('stops when acknowledged bytes exceed the file size and never finalizes', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(308, { range: 'bytes=0-9' }))

    await expect(uploadImportFileDirectly(uploadParams(fileOfSize(4)))).rejects.toThrow(
      /more bytes than the file size/,
    )
    expect(finalizeDirectImportUpload).not.toHaveBeenCalled()
  })

  it('keeps querying a full-file 308 and finalizes only after a final 200', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(308, { range: 'bytes=0-3' }))
      .mockResolvedValueOnce(response(308, { range: 'bytes=0-3' }))
      .mockResolvedValueOnce(response(200))

    const job = await uploadImportFileDirectly(uploadParams(fileOfSize(4)))

    expect(contentRanges(fetchMock)).toEqual(['bytes 0-3/4', 'bytes */4', 'bytes */4'])
    expect(finalizeDirectImportUpload).toHaveBeenCalledTimes(1)
    expect(job).toBe(dryRunJob)
  })

  it('recovers from a chunk 503 through a full-file 308 without finalizing early', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(308, { range: 'bytes=0-3' }))
      .mockResolvedValueOnce(response(200))

    const job = await uploadImportFileDirectly(uploadParams(fileOfSize(4)))

    expect(contentRanges(fetchMock)).toEqual(['bytes 0-3/4', 'bytes */4', 'bytes */4'])
    expect(finalizeDirectImportUpload).toHaveBeenCalledTimes(1)
    expect(job).toBe(dryRunJob)
  })

  it('completes when the recovery probe returns a final 200', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200))

    const job = await uploadImportFileDirectly(uploadParams(fileOfSize(4)))

    expect(contentRanges(fetchMock)).toEqual(['bytes 0-3/4', 'bytes */4'])
    expect(finalizeDirectImportUpload).toHaveBeenCalledTimes(1)
    expect(job).toBe(dryRunJob)
  })

  it('retries the probe after a transient probe failure', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200))

    const job = await uploadImportFileDirectly(uploadParams(fileOfSize(4)))

    expect(contentRanges(fetchMock)).toEqual([
      'bytes 0-3/4',
      'bytes */4',
      'bytes 0-3/4',
      'bytes */4',
    ])
    expect(finalizeDirectImportUpload).toHaveBeenCalledTimes(1)
    expect(job).toBe(dryRunJob)
  })

  it('stops when a probe acknowledges bytes beyond the file size', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(308, { range: 'bytes=0-9' }))

    await expect(uploadImportFileDirectly(uploadParams(fileOfSize(4)))).rejects.toThrow(
      /more bytes than the file size/,
    )
    expect(finalizeDirectImportUpload).not.toHaveBeenCalled()
  })

  it('gives up when the server never returns a final response', async () => {
    fetchMock
      .mockResolvedValueOnce(response(201, { location: 'https://storage.example/session' }))
      .mockResolvedValueOnce(response(308, { range: 'bytes=0-3' }))
      .mockResolvedValue(response(308, { range: 'bytes=0-3' }))

    await expect(uploadImportFileDirectly(uploadParams(fileOfSize(4)))).rejects.toThrow(
      /did not return a final response/,
    )
    expect(finalizeDirectImportUpload).not.toHaveBeenCalled()
  })
})
