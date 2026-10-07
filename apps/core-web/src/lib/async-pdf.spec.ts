import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PDF_POLL_INTERVAL_MS,
  DEFAULT_PDF_POLL_TIMEOUT_MS,
  DEFAULT_PDF_POLL_TIMEOUT_ERROR_MESSAGE,
  downloadPdfFromGetUrl,
  generateAndDownloadPdfBlob,
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
    vi.clearAllMocks()
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

  it('applies backoff multiplier up to max interval across multiple attempts', async () => {
    vi.useFakeTimers()
    const pdfBlob = new Blob(['%PDF'], { type: 'application/pdf' })
    const fetchPdf = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Invoice PDF is not generated yet' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Invoice PDF is not generated yet' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Invoice PDF is not generated yet' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => pdfBlob,
      })

    const onPoll = vi.fn()
    const promise = pollUntilPdfBlob(fetchPdf, {
      intervalMs: 1_000,
      backoffMultiplier: 2,
      maxIntervalMs: 3_000,
      timeoutMs: 30_000,
      onPoll,
    })

    // Attempt 1 happened immediately
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchPdf).toHaveBeenCalledTimes(1)
    expect(onPoll).toHaveBeenCalledWith(1)

    // After 999ms, interval 1 (1000ms) has not elapsed
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchPdf).toHaveBeenCalledTimes(1)

    // At 1000ms, attempt 2 fires
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPdf).toHaveBeenCalledTimes(2)
    expect(onPoll).toHaveBeenCalledWith(2)

    // Interval 2 should be 2000ms (1000 * 2)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchPdf).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPdf).toHaveBeenCalledTimes(3)
    expect(onPoll).toHaveBeenCalledWith(3)

    // Interval 3 should be capped at maxIntervalMs (3000ms, not 4000ms)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(fetchPdf).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPdf).toHaveBeenCalledTimes(4)
    expect(onPoll).toHaveBeenCalledWith(4)

    const blob = await promise
    expect(blob).toBe(pdfBlob)
  })

  it('respects custom timeoutErrorMessage on timeout', async () => {
    vi.useFakeTimers()
    const fetchPdf = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Invoice PDF is not generated yet' }),
    })

    const promise = pollUntilPdfBlob(fetchPdf, {
      intervalMs: 1_000,
      timeoutMs: 2_500,
      timeoutErrorMessage: 'Custom timeout message',
    })

    const assertion = expect(promise).rejects.toThrow('Custom timeout message')
    await vi.advanceTimersByTimeAsync(3_000)
    await assertion
  })

  it('defaults timeout error message to German copy', async () => {
    vi.useFakeTimers()
    const fetchPdf = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Invoice PDF is not generated yet' }),
    })

    const promise = pollUntilPdfBlob(fetchPdf, {
      intervalMs: 1_000,
      timeoutMs: 2_500,
    })

    const assertion = expect(promise).rejects.toThrow(
      'PDF-Erstellung dauert zu lange. Bitte versuchen Sie es in Kürze erneut.',
    )
    await vi.advanceTimersByTimeAsync(3_000)
    await assertion
    expect(DEFAULT_PDF_POLL_TIMEOUT_ERROR_MESSAGE).toBe(
      'PDF-Erstellung dauert zu lange. Bitte versuchen Sie es in Kürze erneut.',
    )
  })

  it('defaults DEFAULT_PDF_POLL_TIMEOUT_MS to 60_000', () => {
    expect(DEFAULT_PDF_POLL_TIMEOUT_MS).toBe(60_000)
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

describe('generateAndDownloadPdfBlob', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('downloads immediately without polling when mode is cached', async () => {
    const pdfBlob = new Blob(['%PDF-cached'], { type: 'application/pdf' })
    const callOrder: string[] = []

    vi.mocked(fetchWithAuth).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        callOrder.push('POST')
        return {
          ok: true,
          json: async () => ({ mode: 'cached' }),
        } as Response
      }
      callOrder.push('GET')
      return {
        ok: true,
        blob: async () => pdfBlob,
      } as Response
    })

    const onPoll = vi.fn()
    const blob = await generateAndDownloadPdfBlob({
      postUrl: '/api/sales/invoices/inv-1/pdf',
      getUrl: '/api/sales/invoices/inv-1/pdf',
      onPoll,
    })

    expect(blob).toBe(pdfBlob)
    expect(callOrder).toEqual(['POST', 'GET'])
    expect(fetchWithAuth).toHaveBeenNthCalledWith(1, '/api/sales/invoices/inv-1/pdf', {
      method: 'POST',
      signal: undefined,
    })
    expect(fetchWithAuth).toHaveBeenNthCalledWith(2, '/api/sales/invoices/inv-1/pdf', {
      headers: { Accept: 'application/pdf' },
      cache: 'no-store',
      signal: undefined,
    })
    expect(onPoll).not.toHaveBeenCalled()
  })

  it('awaits POST first and polls GET until 200 when mode is enqueued', async () => {
    vi.useFakeTimers()
    const pdfBlob = new Blob(['%PDF-enqueued'], { type: 'application/pdf' })
    const callOrder: string[] = []

    vi.mocked(fetchWithAuth).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        callOrder.push('POST')
        return {
          ok: true,
          json: async () => ({ mode: 'enqueued' }),
        } as Response
      }
      callOrder.push('GET')
      if (callOrder.filter((c) => c === 'GET').length === 1) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ message: 'Invoice PDF is not generated yet' }),
        } as Response
      }
      return {
        ok: true,
        blob: async () => pdfBlob,
      } as Response
    })

    const onPoll = vi.fn()
    const promise = generateAndDownloadPdfBlob({
      postUrl: '/api/sales/invoices/inv-1/pdf',
      getUrl: '/api/sales/invoices/inv-1/pdf',
      intervalMs: 1_000,
      onPoll,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(callOrder).toEqual(['POST', 'GET'])
    expect(onPoll).toHaveBeenCalledWith(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(callOrder).toEqual(['POST', 'GET', 'GET'])
    expect(onPoll).toHaveBeenCalledWith(2)

    const blob = await promise
    expect(blob).toBe(pdfBlob)
  })

  it('fails if POST returns non-ok response', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invoice locking failed' }),
    } as Response)

    await expect(
      generateAndDownloadPdfBlob({
        postUrl: '/api/sales/invoices/inv-1/pdf',
        getUrl: '/api/sales/invoices/inv-1/pdf',
      }),
    ).rejects.toThrow('Invoice locking failed')

    expect(fetchWithAuth).toHaveBeenCalledTimes(1)
  })

  it('uses errorFallbackMessage if POST returns non-ok response without message', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    await expect(
      generateAndDownloadPdfBlob({
        postUrl: '/api/sales/invoices/inv-1/pdf',
        getUrl: '/api/sales/invoices/inv-1/pdf',
        errorFallbackMessage: 'Custom generation fallback',
      }),
    ).rejects.toThrow('Custom generation fallback')
  })

  it('fails if checkGenerationFailed reports an error during polling', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mode: 'enqueued' }),
    } as Response)

    await expect(
      generateAndDownloadPdfBlob({
        postUrl: '/api/sales/invoices/inv-1/pdf',
        getUrl: '/api/sales/invoices/inv-1/pdf',
        checkGenerationFailed: async () => 'Renderer crashed: font not found',
      }),
    ).rejects.toThrow('Renderer crashed: font not found')
  })
})
