import { fetchWithAuth } from '@/api/client'

export const DEFAULT_PDF_POLL_INTERVAL_MS = 1_500
export const DEFAULT_PDF_POLL_TIMEOUT_MS = 90_000

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

export type PollPdfOptions = {
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
  onPoll?: (attempt: number) => void
  checkGenerationFailed?: () => Promise<string | null>
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function pollUntilPdfBlob(
  fetchPdf: () => Promise<Response>,
  options: PollPdfOptions = {},
): Promise<Blob> {
  const intervalMs = options.intervalMs ?? DEFAULT_PDF_POLL_INTERVAL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_PDF_POLL_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
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

    await sleep(intervalMs, options.signal)
  }

  throw new Error(
    'PDF generation is taking longer than expected. Please try Print again in a moment.',
  )
}

export async function downloadPdfFromGetUrl(
  url: string,
  options?: { poll?: boolean; pollOptions?: PollPdfOptions },
): Promise<Blob> {
  const fetchPdf = () =>
    fetchWithAuth(url, {
      headers: { Accept: 'application/pdf' },
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
