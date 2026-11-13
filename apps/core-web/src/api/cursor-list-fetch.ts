import { fetchWithAuth } from './client'
import { StaleScopeResponseError, throwCursorListApiError } from './cursor-list-api-error'
import {
  getProtectedGeneration,
  getScopeContextDigest,
  latchScopeExplicitRefresh,
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

type ScopeEchoOptions = { expectedScopeDigest?: string }

/** Drops a response for another scope or an older generation. A generation bump has already quarantined; an echo of a
 * scope this request did not send latches the explicit-refresh quarantine, so "Liste aktualisieren" is the way back. */
function rejectForeignOrStaleEcho(
  echoedDigest: string | undefined,
  observedGeneration: number,
  expectedScopeDigest?: string,
): void {
  if (expectedScopeDigest !== undefined && echoedDigest !== undefined && echoedDigest !== expectedScopeDigest) {
    if (observedGeneration === getProtectedGeneration()) latchScopeExplicitRefresh()
    throw new StaleScopeResponseError(false)
  }
  if (shouldDiscardScopeEcho(echoedDigest, observedGeneration)) throw new StaleScopeResponseError(true)
}

/** The header is read from the store at send time, the expected digest from the query key: when they no longer agree
 * (a handshake changed the scope since the key was built), the request is not sent; the new key reads the new scope. */
function assertKeyMatchesCurrentScope(expectedScopeDigest: string | undefined) {
  if (expectedScopeDigest !== undefined && getScopeContextDigest() !== expectedScopeDigest) {
    throw new StaleScopeResponseError(false)
  }
}

/** One scoped read: not sent for an outdated key, retried once on a network error or 5xx, dropped on a stale echo. */
async function fetchScoped<T>(
  url: string,
  signal: AbortSignal,
  options: ScopeEchoOptions | undefined,
  echoOf: (body: T) => string | undefined,
): Promise<T> {
  assertKeyMatchesCurrentScope(options?.expectedScopeDigest)
  const observedGeneration = getProtectedGeneration()
  const body = await onceWithNetworkRetry(async () =>
    parseJson<T>(await fetchWithAuth(url, { signal, headers: headersWithScopeContext() })),
  )
  rejectForeignOrStaleEcho(echoOf(body), observedGeneration, options?.expectedScopeDigest)
  return body
}

type CursorPageBody<TRow> = { data: TRow[]; meta: { nextCursor: string | null; hasNextPage: boolean; scopeContextDigest?: string } }

export function fetchCursorListPage<TRow>(url: string, signal: AbortSignal, options?: ScopeEchoOptions) {
  return fetchScoped<CursorPageBody<TRow>>(url, signal, options, (body) => body.meta?.scopeContextDigest)
}

export function fetchCursorListCount<T extends ScopeEchoCount>(url: string, signal: AbortSignal, options?: ScopeEchoOptions) {
  return fetchScoped<T>(url, signal, options, (body) => body.scopeContextDigest)
}
