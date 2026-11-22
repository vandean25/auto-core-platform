import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { ScopeContextGate } from '@/auth/ScopeContextProvider'
import { resetScopeContextClientForTests } from '@/auth/scope-context-client'
import App from '@/App'

const mockUseAuth = vi.fn()
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('@/features/realtime/RealtimeDashboardSyncProvider', () => ({
  RealtimeDashboardSyncProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const okJson = (body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: true, status: 200, headers: new Headers(headers), text: async () => JSON.stringify(body), json: async () => body }) as unknown as Response

const sessionPayload = {
  platformRole: null,
  activeTenant: { id: 't1', name: 'Test Tenant', slug: 'test-tenant' },
  activeRole: 'ADMIN',
  memberships: [],
  activeSiteId: 'site-1',
}

function mountApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ScopeContextGate><App /></ScopeContextGate>
    </QueryClientProvider>,
  )
}

function setupMockFetch(scopeGate: ReturnType<typeof deferred<Response>>, authMeGate: ReturnType<typeof deferred<Response>>) {
  const startedUrls: string[] = []
  vi.mocked(fetchWithAuth).mockImplementation(async (input) => {
    const url = String(input)
    startedUrls.push(url)
    if (url === '/api/auth/scope-context') return scopeGate.promise
    if (url === '/api/auth/me') return authMeGate.promise
    if (url === '/api/me/sites') return okJson([{ id: 'site-1', code: 'S1', name: 'Site 1', legalEntityId: 'le-1' }])
    if (url === '/api/saved-views') return okJson({ data: [] })
    return okJson({ data: [], meta: { total: 0, page: 1, pageSize: 10, pageCount: 1 } })
  })
  return startedUrls
}

describe('bootstrap request waterfall (AUT-1025 Scenario 2)', () => {
  beforeEach(() => {
    resetScopeContextClientForTests()
    vi.clearAllMocks()
    window.history.pushState({}, '', '/purchase-orders')
  })

  afterEach(() => {
    cleanup()
    window.history.pushState({}, '', '/')
  })

  it('fires scope-context, /api/auth/me, /api/me/sites and /api/saved-views concurrently before auth settles, while holding page data until auth+scope resolve', async () => {
    mockUseAuth.mockReturnValue({
      user: { uid: 'u1', email: 'admin@test.com' },
      claims: { tenantId: 't1', role: 'ADMIN' },
      loading: false,
      authInitTimedOut: false,
      signOutUser: vi.fn(),
    })
    const scopeGate = deferred<Response>()
    const authMeGate = deferred<Response>()
    const startedUrls = setupMockFetch(scopeGate, authMeGate)
    mountApp()

    await waitFor(() => {
      expect(startedUrls).toEqual(expect.arrayContaining(['/api/auth/scope-context', '/api/auth/me', '/api/me/sites', '/api/saved-views']))
    })
    expect(startedUrls.some((u) => u.startsWith('/api/purchase-orders'))).toBe(false)

    scopeGate.resolve(okJson({ scopeContext: 'sc-1', scopeContextDigest: 'd-1' }, { 'x-autocore-scope-context': 'sc-1', 'x-autocore-scope-context-digest': 'd-1' }))
    authMeGate.resolve(okJson(sessionPayload))

    await waitFor(() => expect(startedUrls.some((u) => u.startsWith('/api/purchase-orders'))).toBe(true), { timeout: 5000 })
    expect(startedUrls.filter((u) => u === '/api/me/sites')).toHaveLength(1)
    expect(startedUrls.filter((u) => u === '/api/saved-views')).toHaveLength(1)
    expect(startedUrls.some((u) => u.includes('/api/workshop/resources'))).toBe(false)
  })

  it('does not fire /api/me/sites or /api/saved-views before /api/auth/me when tenantId claim is absent', async () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'u1', email: 'admin@test.com' }, claims: null, loading: false, authInitTimedOut: false, signOutUser: vi.fn() })
    const scopeGate = deferred<Response>()
    const authMeGate = deferred<Response>()
    const startedUrls = setupMockFetch(scopeGate, authMeGate)
    mountApp()

    await waitFor(() => expect(startedUrls).toEqual(expect.arrayContaining(['/api/auth/scope-context', '/api/auth/me'])))
    expect(startedUrls).not.toContain('/api/me/sites')
    expect(startedUrls).not.toContain('/api/saved-views')

    scopeGate.resolve(okJson({ scopeContext: 'sc-1', scopeContextDigest: 'd-1' }, { 'x-autocore-scope-context': 'sc-1', 'x-autocore-scope-context-digest': 'd-1' }))
    authMeGate.resolve(okJson(sessionPayload))
    await waitFor(() => expect(startedUrls).toEqual(expect.arrayContaining(['/api/me/sites', '/api/saved-views'])))
  })

  it('does not issue any bootstrap API calls when unauthenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, claims: null, loading: false, authInitTimedOut: false, signOutUser: vi.fn() })
    mountApp()
    expect(fetchWithAuth).not.toHaveBeenCalled()
  })
})
