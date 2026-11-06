import { useQueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { refreshInfiniteList } from '@/lib/infinite-list-query'

function queryNeedsRefresh(queryClient: ReturnType<typeof useQueryClient>, queryKey: QueryKey): boolean {
  return queryClient.getQueryCache().find({ queryKey, exact: true })?.state.isInvalidated === true
}

export function useInfiniteListRefresh(queryKey: QueryKey) {
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const needsRefresh = useSyncExternalStore(
    (onStoreChange) => queryClient.getQueryCache().subscribe(onStoreChange),
    () => queryNeedsRefresh(queryClient, queryKey),
    () => false,
  )

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await refreshInfiniteList(queryClient, queryKey)
    } finally {
      setIsRefreshing(false)
    }
  }, [queryClient, queryKey])

  return { needsRefresh, refresh, isRefreshing }
}
