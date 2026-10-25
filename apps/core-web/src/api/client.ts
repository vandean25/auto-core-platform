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

function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) {
    return
  }
  throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal | undefined {
  if (signals.length === 0) {
    return undefined
  }
  if (signals.length === 1) {
    return signals[0]
  }
  return AbortSignal.any(signals)
}

async function awaitWithAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) {
    return promise
  }

  throwIfAborted(signal)

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort, { once: true })

    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          onAbort()
          return
        }
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
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
  throwIfAborted(init?.signal)

  const resolvedInput = resolveApiUrl(input)
  const signals: AbortSignal[] = []
  if (requestTargetsAuthMe(resolvedInput)) {
    signals.push(AbortSignal.timeout(AUTH_SESSION_FETCH_TIMEOUT_MS))
  }
  if (init?.signal) {
    signals.push(init.signal)
  }
  const requestSignal = mergeAbortSignals(signals)

  const headers = new Headers(init?.headers)

  const testToken = isE2ETestTokenAuthEnabled() ? getE2ETestToken() : null
  if (testToken) {
    headers.set('Authorization', `Bearer ${testToken}`)
  } else {
    const currentUser = firebaseAuth?.currentUser
    if (currentUser) {
      const idToken = await awaitWithAbortSignal(currentUser.getIdToken(), requestSignal)
      headers.set('Authorization', `Bearer ${idToken}`)
    }
  }

  throwIfAborted(requestSignal)

  const config: RequestInit = {
    ...init,
    headers,
    signal: requestSignal,
  }

  return fetch(resolvedInput, config)
}
