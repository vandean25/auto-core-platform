import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import { triggerBlobDownload } from '@/lib/download'
import { toast } from 'sonner'
import { usePdfDownload } from './usePdfDownload'

vi.mock('sonner', () => {
  let toastIdCounter = 0
  return {
    toast: {
      loading: vi.fn((_message: string, opts?: { id?: string | number }) => {
        return opts?.id ?? `toast-${++toastIdCounter}`
      }),
      success: vi.fn(),
      error: vi.fn(),
      dismiss: vi.fn(),
    },
  }
})

vi.mock('@/lib/download', () => ({
  triggerBlobDownload: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn(),
}))

describe('usePdfDownload', () => {
  const dummyBlob = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cached mode: POST returns { mode: "cached" } -> immediately GETs PDF -> triggers download and success toast', async () => {
    const postUrl = '/api/invoices/inv-1/pdf'
    const getUrl = '/api/invoices/inv-1/pdf'
    const filename = 'invoice-inv-1.pdf'

    vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ mode: 'cached' }),
        } as unknown as Response
      }
      if (url === getUrl) {
        return {
          ok: true,
          status: 200,
          blob: async () => dummyBlob,
        } as unknown as Response
      }
      return { ok: false, status: 404 } as unknown as Response
    })

    const onSuccess = vi.fn()
    const { result } = renderHook(() =>
      usePdfDownload({
        postUrl,
        getUrl,
        filename,
        onSuccess,
      }),
    )

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isDownloading).toBe(false)

    let downloadPromise: Promise<boolean> | undefined
    act(() => {
      downloadPromise = result.current.download()
    })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isDownloading).toBe(true)

    let success: boolean | undefined
    await act(async () => {
      success = await downloadPromise
    })

    expect(success).toBe(true)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isDownloading).toBe(false)
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1)
    expect(triggerBlobDownload).toHaveBeenCalledWith(dummyBlob, filename)
    expect(toast.loading).toHaveBeenCalledWith('Preparing PDF, this may take a few seconds...')
    expect(toast.success).toHaveBeenCalledWith('PDF downloaded successfully', { id: expect.any(String) })
    expect(onSuccess).toHaveBeenCalledWith(dummyBlob)
  })

  it('enqueued -> ready: POST returns { mode: "enqueued" } -> GET 1 returns 404 -> timer advances -> GET 2 returns 200 -> triggers download and success toast', async () => {
    const postUrl = '/api/credit-notes/cn-1/pdf'
    const getUrl = '/api/credit-notes/cn-1/pdf'
    const filename = 'credit-note-cn-1.pdf'

    let getAttempt = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ mode: 'enqueued' }),
        } as unknown as Response
      }
      getAttempt++
      if (getAttempt === 1) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ message: 'Credit note PDF is not generated yet' }),
        } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        blob: async () => dummyBlob,
      } as unknown as Response
    })

    const { result } = renderHook(() =>
      usePdfDownload({
        postUrl,
        getUrl,
        filename,
        intervalMs: 1000,
      }),
    )

    let downloadPromise: Promise<boolean> | undefined
    act(() => {
      downloadPromise = result.current.download()
    })

    // Wait for the first attempt to be processed and sleep to be reached
    await act(async () => {
      await Promise.resolve()
    })

    expect(getAttempt).toBe(1)
    expect(toast.loading).toHaveBeenCalledWith('Generating PDF in the background...', {
      id: expect.any(String),
    })

    // Advance timer to trigger next poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    const success = await downloadPromise

    expect(success).toBe(true)
    expect(getAttempt).toBe(2)
    expect(triggerBlobDownload).toHaveBeenCalledWith(dummyBlob, filename)
    expect(toast.success).toHaveBeenCalledWith('PDF downloaded successfully', { id: expect.any(String) })
    expect(result.current.isLoading).toBe(false)
  })

  it('404-then-200 race: GET returns 404 before PDF is ready -> hook continues polling until 200, and verifies POST is awaited before GET is invoked', async () => {
    const postUrl = '/api/invoices/inv-race/pdf'
    const getUrl = '/api/invoices/inv-race/pdf'
    const filename = 'invoice-race.pdf'

    const callOrder: string[] = []
    let getCalls = 0

    vi.mocked(fetchWithAuth).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        callOrder.push('POST')
        return {
          ok: true,
          status: 200,
          json: async () => ({ mode: 'enqueued' }),
        } as unknown as Response
      }
      getCalls++
      callOrder.push(`GET-${getCalls}`)
      if (getCalls < 3) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ message: 'Invoice PDF is not generated yet' }),
        } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        blob: async () => dummyBlob,
      } as unknown as Response
    })

    const { result } = renderHook(() =>
      usePdfDownload({
        postUrl,
        getUrl,
        filename,
        intervalMs: 1000,
        backoffMultiplier: 1,
      }),
    )

    let downloadPromise: Promise<boolean> | undefined
    act(() => {
      downloadPromise = result.current.download()
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Ensure POST was invoked before any GET
    expect(callOrder[0]).toBe('POST')
    expect(callOrder[1]).toBe('GET-1')

    // Advance for GET 2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(callOrder[2]).toBe('GET-2')

    // Advance for GET 3 (200 success)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(callOrder[3]).toBe('GET-3')

    const success = await downloadPromise
    expect(success).toBe(true)
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1)
  })

  it('terminal FAILED: checkGenerationFailed returns "Renderer failed: syntax error" -> polling terminates immediately -> error toast displayed with message -> isLoading = false', async () => {
    const postUrl = '/api/orders/ord-fail/pdf'
    const getUrl = '/api/orders/ord-fail/pdf'
    const filename = 'order-fail.pdf'

    vi.mocked(fetchWithAuth).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ mode: 'enqueued' }),
        } as unknown as Response
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'Order PDF is not generated yet' }),
      } as unknown as Response
    })

    const checkGenerationFailed = vi.fn().mockResolvedValue('Renderer failed: syntax error')
    const onError = vi.fn()

    const { result } = renderHook(() =>
      usePdfDownload({
        postUrl,
        getUrl,
        filename,
        checkGenerationFailed,
        onError,
      }),
    )

    let downloadPromise: Promise<boolean> | undefined
    act(() => {
      downloadPromise = result.current.download()
    })

    let success: boolean | undefined
    await act(async () => {
      success = await downloadPromise
    })

    expect(success).toBe(false)
    expect(checkGenerationFailed).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Renderer failed: syntax error', { id: expect.any(String) })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Renderer failed: syntax error' }))
    expect(triggerBlobDownload).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isDownloading).toBe(false)
  })

  it('timeout: repeated 404s exceed timeoutMs -> polling aborts -> error toast displayed (with German copy/message) -> isLoading = false', async () => {
    const postUrl = '/api/invoices/inv-timeout/pdf'
    const getUrl = '/api/invoices/inv-timeout/pdf'
    const filename = 'invoice-timeout.pdf'

    vi.mocked(fetchWithAuth).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ mode: 'enqueued' }),
        } as unknown as Response
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'Invoice PDF is not generated yet' }),
      } as unknown as Response
    })

    const timeoutMessage = 'PDF-Erstellung dauert zu lange. Bitte versuchen Sie es in Kürze erneut.'
    const { result } = renderHook(() =>
      usePdfDownload({
        postUrl,
        getUrl,
        filename,
        timeoutMs: 3000,
        intervalMs: 1000,
        backoffMultiplier: 1,
        messages: {
          timeout: timeoutMessage,
        },
      }),
    )

    let downloadPromise: Promise<boolean> | undefined
    act(() => {
      downloadPromise = result.current.download()
    })

    // Advance beyond timeout
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500)
    })

    const success = await downloadPromise

    expect(success).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(timeoutMessage, { id: expect.any(String) })
    expect(triggerBlobDownload).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })

  it('unmount abort: unmounting component while download is in flight triggers AbortController abort -> no state updates on unmounted component -> no error toast shown', async () => {
    const postUrl = '/api/invoices/inv-unmount/pdf'
    const getUrl = '/api/invoices/inv-unmount/pdf'
    const filename = 'invoice-unmount.pdf'

    vi.mocked(fetchWithAuth).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ mode: 'enqueued' }),
        } as unknown as Response
      }
      // When GET is called, simulate not ready
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'Invoice PDF is not generated yet' }),
      } as unknown as Response
    })

    const { result, unmount } = renderHook(() =>
      usePdfDownload({
        postUrl,
        getUrl,
        filename,
        intervalMs: 5000,
      }),
    )

    let downloadPromise: Promise<boolean> | undefined
    act(() => {
      downloadPromise = result.current.download()
    })

    // Wait until it enters sleep waiting for next poll
    await act(async () => {
      await Promise.resolve()
    })

    // Unmount while sleeping
    unmount()

    // Advance timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    const success = await downloadPromise

    expect(success).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.dismiss).toHaveBeenCalledWith(expect.any(String))
    expect(triggerBlobDownload).not.toHaveBeenCalled()
  })

  it('double-click guard: calling download() while a download is already in flight is a no-op; only one POST and polling cycle is executed', async () => {
    const postUrl = '/api/invoices/inv-guard/pdf'
    const getUrl = '/api/invoices/inv-guard/pdf'
    const filename = 'invoice-guard.pdf'

    let postCount = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        postCount++
        return {
          ok: true,
          status: 200,
          json: async () => ({ mode: 'cached' }),
        } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        blob: async () => dummyBlob,
      } as unknown as Response
    })

    const { result } = renderHook(() =>
      usePdfDownload({
        postUrl,
        getUrl,
        filename,
      }),
    )

    let firstPromise: Promise<boolean> | undefined
    let secondPromise: Promise<boolean> | undefined

    act(() => {
      firstPromise = result.current.download()
      secondPromise = result.current.download() // double-click immediately
    })

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise])

    expect(firstResult).toBe(true)
    expect(secondResult).toBe(false)
    expect(postCount).toBe(1)
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1)
  })

  it('supports functional config values and download-time overrideConfig', async () => {
    const getUrlFn = vi.fn().mockReturnValue('/api/orders/dynamic/pdf')
    const postUrlFn = vi.fn().mockReturnValue('/api/orders/dynamic/pdf')
    const filenameFn = vi.fn().mockReturnValue('dynamic-order.pdf')

    vi.mocked(fetchWithAuth).mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ mode: 'cached' }),
      blob: async () => dummyBlob,
    } as unknown as Response))

    const { result } = renderHook(() =>
      usePdfDownload({
        postUrl: postUrlFn,
        getUrl: getUrlFn,
        filename: filenameFn,
      }),
    )

    let downloadPromise: Promise<boolean> | undefined
    act(() => {
      downloadPromise = result.current.download({
        filename: 'overridden-name.pdf',
      })
    })

    let success: boolean | undefined
    await act(async () => {
      success = await downloadPromise
    })

    expect(success).toBe(true)
    expect(postUrlFn).toHaveBeenCalledTimes(1)
    expect(getUrlFn).toHaveBeenCalledTimes(1)
    // The override filename should be used instead of filenameFn
    expect(triggerBlobDownload).toHaveBeenCalledWith(dummyBlob, 'overridden-name.pdf')
  })
})
