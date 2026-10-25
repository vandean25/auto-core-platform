import { firebaseAuth } from '@/lib/firebase'
import { getE2ETestToken, isE2ETestTokenAuthEnabled } from '@/lib/runtime-flags'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')

const AUTH_SESSION_FETCH_TIMEOUT_MS = 30_000
const AUTH_ME_PATH_SUFFIX = '/api/auth/me'

function requestTargetsAuthMe(input: RequestInfo | URL): boolean {
  if (typeof input === 'string') {
    const path = input.startsWith('http') ? new URL(input).pathname : input
    return path === AUTH_ME_PATH_SUFFIX || path.endsWith(AUTH_ME_PATH_SUFFIX)
  }

  if (input instanceof URL) {
    return input.pathname === AUTH_ME_PATH_SUFFIX || input.pathname.endsWith(AUTH_ME_PATH_SUFFIX)
  }

  try {
    const path = new URL(input.url).pathname
    return path === AUTH_ME_PATH_SUFFIX || path.endsWith(AUTH_ME_PATH_SUFFIX)
  } catch {
    return false
  }
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal | undefined {
  const active = signals.filter((signal) => !signal.aborted)
  if (active.length === 0) {
    return undefined
  }
  if (active.length === 1) {
    return active[0]
  }
  return AbortSignal.any(active)
}

export function resolveApiUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!API_BASE_URL) return input

  if (typeof input === 'string' && input.startsWith('/api/')) {
    return `${API_BASE_URL}${input}`
  }

  if (input instanceof URL && input.pathname.startsWith('/api/')) {
    return new URL(`${API_BASE_URL}${input.pathname}${input.search}`)
  }

  return input
}

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)

  const testToken = isE2ETestTokenAuthEnabled() ? getE2ETestToken() : null
  if (testToken) {
    headers.set('Authorization', `Bearer ${testToken}`)
  } else {
    const currentUser = firebaseAuth?.currentUser
    if (currentUser) {
      const idToken = await currentUser.getIdToken()
      headers.set('Authorization', `Bearer ${idToken}`)
    }
  }

  const resolvedInput = resolveApiUrl(input)
  const signals: AbortSignal[] = []
  if (requestTargetsAuthMe(resolvedInput)) {
    signals.push(AbortSignal.timeout(AUTH_SESSION_FETCH_TIMEOUT_MS))
  }
  if (init?.signal) {
    signals.push(init.signal)
  }

  const config: RequestInit = {
    ...init,
    headers,
    signal: mergeAbortSignals(signals),
  }

  return fetch(resolvedInput, config)
}
