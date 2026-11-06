import { QueryClientContext, hashKey } from '@tanstack/react-query'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useInfiniteListRefresh } from '@/hooks/useInfiniteListRefresh'
import {
  INFINITE_LIST_OUTDATED_AFTER_MS,
  INFINITE_LIST_ROW_CAP,
  cancelInfiniteList,
  keepStaleAcrossFetch,
  markInfiniteListStale,
} from '@/lib/infinite-list-query'
import { getTableRowId } from './data-table-body-row'
import type { DataTableInfiniteProps } from './data-table-props'

/** What the grid, the card list and the footer need from an infinite list. Offset-mode tables have none. */
export type DataTableInfiniteView = Pick<
  DataTableInfiniteProps,
  'queryKey' | 'hasNextPage' | 'isFetchingNextPage' | 'isFetchNextPageError' | 'fetchNextPage'
> & {
  canLoadMore: boolean
  /** The 2,000-row stop. It outranks the real end of the list only while pages remain. */
  capReached: boolean
  /** WAI-ARIA `aria-rowcount` including the header row; -1 when the total is unknown or capped. */
  ariaRowCount: number
  needsRefresh: boolean
  isRefreshing: boolean
  refresh: () => void
  /** Bumps whenever the cursor chain restarts (new search/filter/sort or explicit refresh): clear selection, scroll to top. */
  epoch: number
  /** Scroll anchors are remembered per list identity. */
  restoreKey: string
}

/** Loaded rows by stable record ID (ADR-0035 §4), cut at the row cap. */
function mergeLoadedRows<TData extends object>(data: TData[]): TData[] {
  const seen = new Set<string>()
  const merged: TData[] = []
  for (const record of data) {
    const id = getTableRowId(record)
    if (id !== undefined) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    merged.push(record)
    if (merged.length >= INFINITE_LIST_ROW_CAP) break
  }
  return merged
}

function ariaRowCountOf({ hasNextPage, totalCount }: DataTableInfiniteProps, loaded: number) {
  if (loaded > 0 && !hasNextPage) return loaded + 1
  return totalCount && !totalCount.isCapped ? totalCount.count + 1 : -1
}

/**
 * Restart, refresh and staleness of an infinite list (ADR-0035 §6-7). The consumer owns the query; this only
 * reacts to its key and cache. `useContext` rather than `useQueryClient`: offset tables run without a provider.
 */
export function useDataTableInfinite<TData extends object>(
  infinite: DataTableInfiniteProps | undefined,
  data: TData[],
) {
  const client = useContext(QueryClientContext)
  // Callers build the key inline, so its identity changes every render; effects follow it only when its content changes.
  const [queryKey, setQueryKey] = useState(infinite?.queryKey)
  const incomingKey = infinite?.queryKey
  if (incomingKey !== undefined && (queryKey === undefined || hashKey(queryKey) !== hashKey(incomingKey))) {
    setQueryKey(incomingKey)
  }
  const keyHash = queryKey === undefined ? undefined : hashKey(queryKey)
  const { needsRefresh, refresh, isRefreshing } = useInfiniteListRefresh(queryKey)
  const [epoch, setEpoch] = useState(0)
  const isInfinite = infinite !== undefined
  const rows = useMemo(() => (isInfinite ? mergeLoadedRows(data) : data), [data, isInfinite])

  // A changed key is a new result list: abort the chain being left and start the selected one at page one,
  // also when its pages are cached (they stay visible as a locked preview until page one lands).
  const previousKey = useRef(queryKey)
  useLayoutEffect(() => {
    const previous = previousKey.current
    previousKey.current = queryKey
    if (!client || !queryKey || !previous || hashKey(previous) === hashKey(queryKey)) return
    setEpoch((value) => value + 1)
    void cancelInfiniteList(client, previous)
    if (client.getQueryCache().find({ queryKey, exact: true })?.state.data !== undefined) {
      void refresh({ withCount: false }).catch(() => undefined)
    }
  }, [client, queryKey, refresh])

  // Realtime, mutations, mount, focus and reconnect no longer refetch the retained pages (the query is static): they mark
  // the list stale. An event during a load is kept past that load, and an old cache offers the refresh when it is shown again.
  useEffect(() => {
    if (!client || !queryKey) return undefined
    const stopKeeping = keepStaleAcrossFetch(client, queryKey)
    const markIfOutdated = () => {
      const query = client.getQueryCache().find({ queryKey, exact: true })
      if (!query || query.state.data === undefined || query.state.fetchStatus !== 'idle') return
      if (Date.now() - query.state.dataUpdatedAt > INFINITE_LIST_OUTDATED_AFTER_MS) markInfiniteListStale(client, queryKey)
    }
    markIfOutdated()
    window.addEventListener('focus', markIfOutdated)
    window.addEventListener('online', markIfOutdated)
    return () => {
      stopKeeping()
      window.removeEventListener('focus', markIfOutdated)
      window.removeEventListener('online', markIfOutdated)
    }
  }, [client, queryKey])

  if (!infinite || keyHash === undefined) return { rows, infiniteView: undefined }

  const capReached = data.length >= INFINITE_LIST_ROW_CAP
  const infiniteView: DataTableInfiniteView = {
    queryKey: infinite.queryKey,
    hasNextPage: infinite.hasNextPage,
    isFetchingNextPage: infinite.isFetchingNextPage,
    isFetchNextPageError: infinite.isFetchNextPageError,
    fetchNextPage: infinite.fetchNextPage,
    capReached,
    canLoadMore: infinite.hasNextPage && !capReached,
    ariaRowCount: ariaRowCountOf(infinite, rows.length),
    needsRefresh,
    isRefreshing,
    refresh: () => {
      setEpoch((value) => value + 1)
      void refresh().catch(() => undefined)
    },
    epoch,
    restoreKey: keyHash,
  }
  return { rows, infiniteView }
}
