// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth, resolveApiUrl } from './client'

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: null,
}))

vi.mock('@/lib/runtime-flags', () => ({
  getE2ETestToken: () => null,
  isE2ETestTokenAuthEnabled: () => false,
}))

describe('resolveApiUrl', () => {
  it('preserves relative API paths when no API base URL is configured', () => {
    const input = '/api/auth/me'

    expect(resolveApiUrl(input)).toBe(input)
  })

  it('preserves URL API paths when no API base URL is configured', () => {
    const input = new URL('https://auto-core-platform-vande.web.app/api/auth/me?refresh=true')

    expect(resolveApiUrl(input)).toBe(input)
  })
})

describe('fetchWithAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('aborts /api/auth/me when the request hangs beyond the session timeout', async () => {
    const timeoutController = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchWithAuth('/api/auth/me')
    timeoutController.abort(new DOMException('Timeout', 'TimeoutError'))

    await expect(pending).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('does not apply the session timeout to non-auth API calls', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchWithAuth('/api/inventory?page=1')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit?]
    expect(init?.signal).toBeUndefined()
  })
})
