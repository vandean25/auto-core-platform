import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { fetchSavedViews, savedViewKeys } from '@/api/saved-views'
import { fetchMySites, siteKeys } from '@/api/sites'
import { preloadRouteForPathname } from '@/app/route-chunk-prefetch'
import { useAuth } from '@/auth/AuthProvider'

type BootstrapPrefetchInput = {
  queryClient: QueryClient
  userKey: string | null
  tenantId: string | null | undefined
}

/**
 * Fires /api/me/sites and /api/saved-views in parallel with /api/auth/me once auth and tenantId claim exist.
 * Uses the exact React Query keys of AuthenticatedShell and SavedViewsProvider so requests deduplicate (AUT-984).
 */
export function prefetchBootstrapQueries({ queryClient, userKey, tenantId }: BootstrapPrefetchInput): void {
  if (!userKey || !tenantId) {
    return
  }

  void queryClient.prefetchQuery({
    queryKey: siteKeys.me(tenantId),
    queryFn: fetchMySites,
  })

  void queryClient.prefetchQuery({
    queryKey: savedViewKeys.list(tenantId, userKey),
    queryFn: () => fetchSavedViews(),
  })
}

export function useBootstrapPrefetch(): void {
  const { user, claims, loading } = useAuth()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const userKey = user?.uid ?? user?.email ?? null
  const enabled = Boolean(user) && !loading
  const tenantId = claims?.tenantId

  useEffect(() => {
    preloadRouteForPathname(pathname)
  }, [pathname])

  useEffect(() => {
    if (!enabled) return
    prefetchBootstrapQueries({ queryClient, userKey, tenantId })
  }, [enabled, queryClient, tenantId, userKey])
}
