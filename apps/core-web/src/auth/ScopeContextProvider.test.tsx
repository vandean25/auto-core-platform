import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { isScopeContextQuarantined } from '@/auth/scope-context-client'
import { REALTIME_RESYNC_MIN_INTERVAL_MS } from '@/features/realtime/resync-interval'
import { ScopeContextProvider } from './ScopeContextProvider'

vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: vi.fn() }))

const handshakeBody = { scopeContext: 'vitest-sc', scopeContextDigest: 'vitest-digest', continuityDigest: 'vitest-digest' }

function showPage(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('ScopeContextProvider lifecycle handshake', () => {
  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  // Regression: a phone resume fires visibilitychange but often no focus, so lists kept the previous scope's rows.
  it('quarantines on a visibility resume until the handshake settles', async () => {
    let resolveResume: (value: Response) => void = () => undefined
    let handshakes = 0
    vi.mocked(fetchWithAuth).mockImplementation(async () => {
      handshakes += 1
      if (handshakes === 1) return { ok: true, json: async () => handshakeBody } as Response
      return new Promise<Response>((resolve) => {
        resolveResume = resolve
      })
    })

    const mountedAt = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(mountedAt)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ScopeContextProvider enabled>{null}</ScopeContextProvider>
      </QueryClientProvider>,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(isScopeContextQuarantined()).toBe(false)

    act(() => showPage('hidden'))
    expect(handshakes).toBe(1)

    // Within the throttle of the mount handshake nothing runs.
    act(() => showPage('visible'))
    expect(handshakes).toBe(1)
    expect(isScopeContextQuarantined()).toBe(false)

    act(() => showPage('hidden'))
    vi.mocked(Date.now).mockReturnValue(mountedAt + REALTIME_RESYNC_MIN_INTERVAL_MS)
    act(() => showPage('visible'))
    expect(isScopeContextQuarantined()).toBe(true)
    await waitFor(() => expect(handshakes).toBe(2))

    await act(async () => {
      resolveResume({ ok: true, json: async () => handshakeBody } as Response)
    })
    await waitFor(() => expect(isScopeContextQuarantined()).toBe(false))
  })
})
