import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { siteKeys } from '@/api/sites'
import { savedViewKeys } from '@/api/saved-views'
import { prefetchBootstrapQueries } from './bootstrap-prefetch'

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn(),
}))

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

describe('prefetchBootstrapQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (url === '/api/me/sites') return okJson([{ id: 'site-1', code: 'S1', name: 'Site 1', legalEntityId: 'le-1' }])
      if (url === '/api/saved-views') return okJson({ data: [] })
      throw new Error(`Unexpected URL: ${String(url)}`)
    })
  })

  it('does not issue /api/me/sites or /api/saved-views when userKey or tenantId is missing', () => {
    const queryClient = new QueryClient()

    prefetchBootstrapQueries({ queryClient, userKey: null, tenantId: 'tenant-1' })
    prefetchBootstrapQueries({ queryClient, userKey: 'user-1', tenantId: null })

    expect(fetchWithAuth).not.toHaveBeenCalled()
  })

  it('prefetches /api/me/sites and /api/saved-views once under the canonical query keys when userKey and tenantId exist', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000 } },
    })

    prefetchBootstrapQueries({ queryClient, userKey: 'user-1', tenantId: 'tenant-1' })
    // Second call with the same keys deduplicates via React Query cache.
    prefetchBootstrapQueries({ queryClient, userKey: 'user-1', tenantId: 'tenant-1' })

    await vi.waitFor(() => {
      expect(queryClient.getQueryData(siteKeys.me('tenant-1'))).toBeDefined()
      expect(queryClient.getQueryData(savedViewKeys.list('tenant-1', 'user-1'))).toBeDefined()
    })

    const calls = vi.mocked(fetchWithAuth).mock.calls.map(([url]) => url)
    expect(calls.filter((u) => u === '/api/me/sites')).toHaveLength(1)
    expect(calls.filter((u) => u === '/api/saved-views')).toHaveLength(1)
  })
})
