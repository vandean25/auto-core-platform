import { fetchWithAuth } from './client'
import { throwCursorListApiError } from './cursor-list-api-error'
import {
  getProtectedGeneration,
  scopeContextHeaderValue,
  shouldDiscardScopeEcho,
  SCOPE_CONTEXT_HEADER,
} from '@/auth/scope-context-client'

type ScopeEchoCount = { scopeContextDigest?: string }

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    await throwCursorListApiError(response, 'Failed to fetch cursor list')
  }
  return response.json() as Promise<T>
}

function headersWithScopeContext(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  const scopeContext = scopeContextHeaderValue()
  if (scopeContext) headers.set(SCOPE_CONTEXT_HEADER, scopeContext)
  return headers
}

async function onceWithNetworkRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const status = (error as { status?: number }).status
    const retryable = error instanceof TypeError || (status !== undefined && status >= 500)
    if (!retryable) throw error
    return run()
  }
}

export async function fetchCursorListPage<TRow>(
  url: string,
  signal: AbortSignal,
): Promise<{ data: TRow[]; meta: { nextCursor: string | null; hasNextPage: boolean; scopeContextDigest?: string } }> {
  const observedGeneration = getProtectedGeneration()
  const body = await onceWithNetworkRetry(async () =>
    parseJson<{ data: TRow[]; meta: { nextCursor: string | null; hasNextPage: boolean; scopeContextDigest?: string } }>(
      await fetchWithAuth(url, { signal, headers: headersWithScopeContext() }),
    ),
  )
  if (shouldDiscardScopeEcho(body.meta?.scopeContextDigest, observedGeneration)) {
    throw new Error('stale_scope_context_response')
  }
  return body
}

export async function fetchCursorListCount<T extends ScopeEchoCount>(url: string, signal: AbortSignal): Promise<T> {
  const observedGeneration = getProtectedGeneration()
  const body = await onceWithNetworkRetry(async () =>
    parseJson<T>(await fetchWithAuth(url, { signal, headers: headersWithScopeContext() })),
  )
  if (shouldDiscardScopeEcho(body.scopeContextDigest, observedGeneration)) {
    throw new Error('stale_scope_context_response')
  }
  return body
}
