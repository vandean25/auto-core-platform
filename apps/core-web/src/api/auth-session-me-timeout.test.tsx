import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthSession } from '@/api/auth-session'

vi.mock('@/lib/runtime-flags', () => ({
  isE2EAuthBypassEnabled: () => false,
  isE2ETestTokenAuthEnabled: () => false,
}))

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: {
    currentUser: {
      uid: 'user-1',
      email: 'testauto@auto.core.at',
      getIdToken: vi.fn().mockResolvedValue('token'),
    },
  },
  firebaseConfigMissing: false,
}))

function SessionStatus() {
  const sessionQuery = useAuthSession('user-1', true)

  if (sessionQuery.isLoading) {
    return <div>session-loading</div>
  }

  if (sessionQuery.isError) {
    return <div>session-error</div>
  }

  return <div>session-ok</div>
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useAuthSession /api/auth/me timeout (AUT-734)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('marks the session query as failed when /api/auth/me hangs past the fetch timeout', async () => {
    const timeoutController = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) {
          return
        }
        if (signal.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
          return
        }
        signal.addEventListener('abort', () => {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(<SessionStatus />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    await act(async () => {
      timeoutController.abort(new DOMException('Timeout', 'TimeoutError'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('session-error')).toBeInTheDocument()
    })
  })
})
