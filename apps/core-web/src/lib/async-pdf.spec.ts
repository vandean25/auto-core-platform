import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PDF_POLL_INTERVAL_MS,
  downloadPdfFromGetUrl,
  isPdfNotReadyHttpStatus,
  pollUntilPdfBlob,
} from './async-pdf'

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn(),
}))

import { fetchWithAuth } from '@/api/client'

describe('isPdfNotReadyHttpStatus', () => {
  it('detects not-yet-generated 404 responses', () => {
    expect(
      isPdfNotReadyHttpStatus(404, 'Credit note PDF is not generated yet'),
    ).toBe(true)
    expect(isPdfNotReadyHttpStatus(404, 'Credit note not found')).toBe(false)
    expect(isPdfNotReadyHttpStatus(500, 'Credit note PDF is not generated yet')).toBe(
      false,
    )
  })
})

describe('pollUntilPdfBlob', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns blob when PDF becomes available', async () => {
    vi.useFakeTimers()
    const pdfBytes = new Uint8Array([1, 2, 3])
    const fetchPdf = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Credit note PDF is not generated yet' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob([pdfBytes], { type: 'application/pdf' }),
      })

    const promise = pollUntilPdfBlob(fetchPdf, {
      intervalMs: DEFAULT_PDF_POLL_INTERVAL_MS,
      timeoutMs: 10_000,
    })

    await vi.advanceTimersByTimeAsync(DEFAULT_PDF_POLL_INTERVAL_MS)
    const blob = await promise
    expect(blob.type).toBe('application/pdf')
    expect(fetchPdf).toHaveBeenCalledTimes(2)
  })

  it('throws when generation failed callback reports an error', async () => {
    const fetchPdf = vi.fn()
    await expect(
      pollUntilPdfBlob(fetchPdf, {
        checkGenerationFailed: async () => 'Playwright crashed',
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow('Playwright crashed')
    expect(fetchPdf).not.toHaveBeenCalled()
  })
})

describe('downloadPdfFromGetUrl', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('requests PDF bytes with cache disabled', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
    } as Response)

    await downloadPdfFromGetUrl('/api/credit-notes/cn-1/pdf')

    expect(fetchWithAuth).toHaveBeenCalledWith('/api/credit-notes/cn-1/pdf', {
      headers: { Accept: 'application/pdf' },
      cache: 'no-store',
      signal: undefined,
    })
  })
})
