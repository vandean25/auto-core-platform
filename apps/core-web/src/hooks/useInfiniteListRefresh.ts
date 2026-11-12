import { QueryClientContext } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { useCallback, useContext, useState, useSyncExternalStore } from 'react'
import {
  isScopeContextQuarantined,
  isScopeExplicitRefreshRequired,
  listQueryKeyForCurrentDigest,
  subscribeScopeContextClient,
} from '@/auth/scope-context-client'
import { refreshInfiniteList } from '@/lib/infinite-list-query'

/** Without a `queryKey` (a DataTable in offset mode) the list never needs a refresh. */
export function useInfiniteListRefresh(queryKey: QueryKey | undefined) {
  const queryClient = useContext(QueryClientContext)
  // Counted, so a refresh superseded by a newer one cannot unlock the list while the newer one still runs.
  const [running, setRunning] = useState(0)
  const needsRefresh = useSyncExternalStore(
    (onStoreChange) => {
      const stopScope = subscribeScopeContextClient(onStoreChange)
      const stopQuery = queryClient?.getQueryCache().subscribe(onStoreChange) ?? (() => undefined)
      return () => {
        stopScope()
        stopQuery()
      }
    },
    () => {
      if (isScopeExplicitRefreshRequired()) return true
      if (queryClient === undefined || queryKey === undefined) return false
      const query = queryClient.getQueryCache().find({ queryKey, exact: true })
      if (query?.state.isInvalidated === true) return true
      // Lifecycle quarantine hides rows immediately; the handshake may still be in flight.
      return isScopeContextQuarantined() && query?.state.data !== undefined
    },
    () => false,
  )

  const refresh = useCallback(
    async (options?: { withCount?: boolean }) => {
      if (!queryClient || queryKey === undefined) return
      setRunning((count) => count + 1)
      try {
        await refreshInfiniteList(queryClient, listQueryKeyForCurrentDigest(queryKey), options)
        // query-core hands new data to observers in a timeout(0); unlocking before that lets the load-ahead fetch
        // the next page of the chain that was just replaced.
        await new Promise((resolve) => setTimeout(resolve, 0))
      } finally {
        setRunning((count) => count - 1)
      }
    },
    [queryClient, queryKey],
  )

  return { needsRefresh, refresh, isRefreshing: running > 0 }
}
