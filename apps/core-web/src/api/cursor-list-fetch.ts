import { CancelledError } from '@tanstack/query-core'

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

function rejectStaleScopeResponse(): never {
  throw new CancelledError({ silent: true })
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

type ScopeEchoOptions = { expectedScopeDigest?: string }

function discardScopeEcho(
  echoedDigest: string | undefined,
  observedGeneration: number,
  expectedScopeDigest?: string,
): boolean {
  if (expectedScopeDigest !== undefined && echoedDigest !== undefined && echoedDigest !== expectedScopeDigest) {
    return true
  }
  return shouldDiscardScopeEcho(echoedDigest, observedGeneration)
}

export async function fetchCursorListPage<TRow>(
  url: string,
  signal: AbortSignal,
  options?: ScopeEchoOptions,
): Promise<{ data: TRow[]; meta: { nextCursor: string | null; hasNextPage: boolean; scopeContextDigest?: string } }> {
  const observedGeneration = getProtectedGeneration()
  const body = await onceWithNetworkRetry(async () =>
    parseJson<{ data: TRow[]; meta: { nextCursor: string | null; hasNextPage: boolean; scopeContextDigest?: string } }>(
      await fetchWithAuth(url, { signal, headers: headersWithScopeContext() }),
    ),
  )
  if (discardScopeEcho(body.meta?.scopeContextDigest, observedGeneration, options?.expectedScopeDigest)) {
    rejectStaleScopeResponse()
  }
  return body
}

export async function fetchCursorListCount<T extends ScopeEchoCount>(
  url: string,
  signal: AbortSignal,
  options?: ScopeEchoOptions,
): Promise<T> {
  const observedGeneration = getProtectedGeneration()
  const body = await onceWithNetworkRetry(async () =>
    parseJson<T>(await fetchWithAuth(url, { signal, headers: headersWithScopeContext() })),
  )
  if (discardScopeEcho(body.scopeContextDigest, observedGeneration, options?.expectedScopeDigest)) {
    rejectStaleScopeResponse()
  }
  return body
}
