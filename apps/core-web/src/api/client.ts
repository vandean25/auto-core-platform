import { firebaseAuth } from '@/lib/firebase'
import { getE2ETestToken, isE2ETestTokenAuthEnabled } from '@/lib/runtime-flags'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')

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

  const config: RequestInit = {
    ...init,
    headers,
  }

  return fetch(resolveApiUrl(input), config)
}
