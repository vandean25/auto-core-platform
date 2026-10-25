// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth, resolveApiUrl } from './client'

const firebaseMocks = vi.hoisted(() => {
  const currentUser = {
    getIdToken: vi.fn().mockResolvedValue('firebase-id-token'),
  }
  return { currentUser }
})

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: {
    currentUser: firebaseMocks.currentUser,
  },
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
    firebaseMocks.currentUser.getIdToken.mockResolvedValue('firebase-id-token')
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

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    timeoutController.abort(new DOMException('Timeout', 'TimeoutError'))

    await expect(pending).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('does not call fetch when the caller signal is already aborted before getIdToken', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))

    await expect(
      fetchWithAuth('/api/inventory?page=1', { signal: controller.signal }),
    ).rejects.toThrow()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(firebaseMocks.currentUser.getIdToken).not.toHaveBeenCalled()
  })

  it('does not call fetch when the caller aborts while getIdToken is pending', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    firebaseMocks.currentUser.getIdToken.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('late-token'), 50)
        }),
    )

    const pending = fetchWithAuth('/api/inventory?page=1', { signal: controller.signal })
    controller.abort(new DOMException('Cancelled', 'AbortError'))

    await expect(pending).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
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
