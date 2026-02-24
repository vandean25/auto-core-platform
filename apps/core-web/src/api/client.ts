import { firebaseAuth } from '@/lib/firebase'

export const API_KEY = import.meta.env.VITE_API_KEY
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')

function resolveApiUrl(input: RequestInfo | URL): RequestInfo | URL {
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

  if (API_KEY) {
    headers.set('x-api-key', API_KEY)
  } else {
    console.warn('VITE_API_KEY is not set')
  }

  const currentUser = firebaseAuth?.currentUser
  if (currentUser) {
    const idToken = await currentUser.getIdToken()
    headers.set('Authorization', `Bearer ${idToken}`)
  }

  const config: RequestInit = {
    ...init,
    headers,
  }

  return fetch(resolveApiUrl(input), config)
}
