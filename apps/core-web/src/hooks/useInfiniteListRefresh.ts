import { QueryClientContext } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { useCallback, useContext, useState, useSyncExternalStore } from 'react'
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
        await refreshInfiniteList(queryClient, queryKey, options)
      } finally {
        setRunning((count) => count - 1)
      }
    },
    [queryClient, queryKey],
  )

  return { needsRefresh, refresh, isRefreshing: running > 0 }
}
