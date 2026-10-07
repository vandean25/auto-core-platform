import { fetchWithAuth } from '@/api/client'

export const DEFAULT_PDF_POLL_INTERVAL_MS = 1_500
export const DEFAULT_PDF_POLL_MAX_INTERVAL_MS = 5_000
export const DEFAULT_PDF_POLL_BACKOFF_MULTIPLIER = 1.5
export const DEFAULT_PDF_POLL_TIMEOUT_MS = 60_000
export const DEFAULT_PDF_POLL_TIMEOUT_ERROR_MESSAGE =
  'PDF-Erstellung dauert zu lange. Bitte versuchen Sie es in Kürze erneut.'

export function isPdfNotReadyHttpStatus(status: number, message: string): boolean {
  return status === 404 && /not generated yet/i.test(message)
}

export async function readPdfDownloadError(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = await response.json().catch(() => ({}))
  const message =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message
      : fallback
  return message
}

export interface PollPdfOptions {
  intervalMs?: number
  maxIntervalMs?: number
  backoffMultiplier?: number
  timeoutMs?: number
  signal?: AbortSignal
  onPoll?: (attempt: number) => void
  checkGenerationFailed?: () => Promise<string | null>
  timeoutErrorMessage?: string
}

export interface GenerateAndDownloadPdfBlobOptions {
  postUrl: string
  getUrl: string
  signal?: AbortSignal
  onPoll?: (attempt: number) => void
  checkGenerationFailed?: () => Promise<string | null>
  intervalMs?: number
  maxIntervalMs?: number
  backoffMultiplier?: number
  timeoutMs?: number
  timeoutErrorMessage?: string
  errorFallbackMessage?: string
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function pollUntilPdfBlob(
  fetchPdf: () => Promise<Response>,
  options: PollPdfOptions = {},
): Promise<Blob> {
  const initialIntervalMs = options.intervalMs ?? DEFAULT_PDF_POLL_INTERVAL_MS
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_PDF_POLL_MAX_INTERVAL_MS
  const backoffMultiplier = options.backoffMultiplier ?? DEFAULT_PDF_POLL_BACKOFF_MULTIPLIER
  const timeoutMs = options.timeoutMs ?? DEFAULT_PDF_POLL_TIMEOUT_MS
  const timeoutErrorMessage =
    options.timeoutErrorMessage ?? DEFAULT_PDF_POLL_TIMEOUT_ERROR_MESSAGE
  const deadline = Date.now() + timeoutMs
  let currentInterval = initialIntervalMs
  let attempt = 0

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    attempt += 1
    options.onPoll?.(attempt)

    const failedMessage = await options.checkGenerationFailed?.()
    if (failedMessage) {
      throw new Error(failedMessage)
    }

    const response = await fetchPdf()
    if (response.ok) {
      return response.blob()
    }

    const message = await readPdfDownloadError(response, 'Failed to download PDF')
    if (!isPdfNotReadyHttpStatus(response.status, message)) {
      throw new Error(message)
    }

    await sleep(currentInterval, options.signal)
    currentInterval = Math.min(currentInterval * backoffMultiplier, maxIntervalMs)
  }

  throw new Error(timeoutErrorMessage)
}

export async function generateAndDownloadPdfBlob(
  options: GenerateAndDownloadPdfBlobOptions,
): Promise<Blob> {
  const response = await fetchWithAuth(options.postUrl, {
    method: 'POST',
    signal: options.signal,
  })

  if (!response.ok) {
    const message = await readPdfDownloadError(
      response,
      options.errorFallbackMessage ?? 'Failed to generate PDF',
    )
    throw new Error(message)
  }

  const body = (await response.json().catch(() => ({}))) as {
    mode?: 'cached' | 'enqueued' | 'generated'
  }

  const fetchPdf = () =>
    fetchWithAuth(options.getUrl, {
      headers: { Accept: 'application/pdf' },
      cache: 'no-store',
      signal: options.signal,
    })

  if (body.mode === 'cached') {
    const getResponse = await fetchPdf()
    if (!getResponse.ok) {
      const message = await readPdfDownloadError(
        getResponse,
        options.errorFallbackMessage ?? 'Failed to download PDF',
      )
      throw new Error(message)
    }
    return getResponse.blob()
  }

  return pollUntilPdfBlob(fetchPdf, {
    intervalMs: options.intervalMs,
    maxIntervalMs: options.maxIntervalMs,
    backoffMultiplier: options.backoffMultiplier,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onPoll: options.onPoll,
    checkGenerationFailed: options.checkGenerationFailed,
    timeoutErrorMessage: options.timeoutErrorMessage,
  })
}

export async function downloadPdfFromGetUrl(
  url: string,
  options?: { poll?: boolean; pollOptions?: PollPdfOptions },
): Promise<Blob> {
  const fetchPdf = () =>
    fetchWithAuth(url, {
      headers: { Accept: 'application/pdf' },
      cache: 'no-store',
      signal: options?.pollOptions?.signal,
    })

  if (options?.poll) {
    return pollUntilPdfBlob(fetchPdf, options.pollOptions)
  }

  const response = await fetchPdf()
  if (!response.ok) {
    throw new Error(await readPdfDownloadError(response, 'Failed to download PDF'))
  }
  return response.blob()
}
