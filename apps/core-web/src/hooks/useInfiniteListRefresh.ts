import { useQueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  infiniteListNeedsRefresh,
  refreshInfiniteList,
  subscribeInfiniteListStale,
} from '@/lib/infinite-list-query'

export function useInfiniteListRefresh(queryKey: QueryKey) {
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const needsRefresh = useSyncExternalStore(
    subscribeInfiniteListStale,
    () => infiniteListNeedsRefresh(queryKey),
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
