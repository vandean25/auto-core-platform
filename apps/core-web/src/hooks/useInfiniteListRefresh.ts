import { QueryClientContext } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { useCallback, useContext, useState, useSyncExternalStore } from 'react'
import { acceptQuarantinedScopeForExplicitRefresh } from '@/auth/scope-context-client'
import { refreshInfiniteList } from '@/lib/infinite-list-query'

/** Without a `queryKey` (a DataTable in offset mode) the list never needs a refresh. */
export function useInfiniteListRefresh(queryKey: QueryKey | undefined) {
  const queryClient = useContext(QueryClientContext)
  // Counted, so a refresh superseded by a newer one cannot unlock the list while the newer one still runs.
  const [running, setRunning] = useState(0)
  const needsRefresh = useSyncExternalStore(
    (onStoreChange) => queryClient?.getQueryCache().subscribe(onStoreChange) ?? (() => undefined),
    () =>
      queryClient !== undefined &&
      queryKey !== undefined &&
      queryClient.getQueryCache().find({ queryKey, exact: true })?.state.isInvalidated === true,
    () => false,
  )

  const refresh = useCallback(
    async (options?: { withCount?: boolean }) => {
      if (!queryClient || queryKey === undefined) return
      setRunning((count) => count + 1)
      try {
        acceptQuarantinedScopeForExplicitRefresh()
        await refreshInfiniteList(queryClient, queryKey, options)
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
