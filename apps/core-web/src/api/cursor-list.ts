import { useInfiniteQuery, useQuery, type QueryKey } from '@tanstack/react-query'
import { useMemo } from 'react'

import { infiniteListQueryOptions } from '@/lib/infinite-list-query'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'

/** Rows per block. Vehicle stock caps a page at 50, the API's smallest ceiling (ADR-0035). */
export const CURSOR_PAGE_LIMIT = 50

export type CappedListCount = components['schemas']['CappedListCountResponseDto']
type CursorListPage<TRow> = { data: TRow[]; meta: { nextCursor: string | null; hasNextPage: boolean } }
type QueryParams = Record<string, string | undefined>

function urlOf(path: string, params: QueryParams) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

async function readJson<T>(path: string, params: QueryParams, signal: AbortSignal): Promise<T> {
  const response = await fetchWithAuth(urlOf(path, params), { signal })
  if (!response.ok) throw new Error(`Failed to fetch ${path}`)
  return response.json() as Promise<T>
}

type CursorListOptions = {
  enabled: boolean
  /** List endpoint and its separate capped-count endpoint (ADR-0035 §5). */
  path: string
  countPath: string
  /** The list key carries filters and sort (a change restarts the chain); the count key carries the filters only. */
  listKey: QueryKey
  countKey: QueryKey
  params: QueryParams
  countParams: QueryParams
}

/**
 * Cursor-paged list plus capped count for a migrated ADR-0035 DataTable. `tableProps` spreads onto `<DataTable>`;
 * with `enabled: false` (offset mode) nothing is requested and the offset hook of the page stays in charge.
 */
export function useCursorList<TRow extends { id: string }>({
  enabled,
  path,
  countPath,
  listKey,
  countKey,
  params,
  countParams,
}: CursorListOptions) {
  const list = useInfiniteQuery({
    ...infiniteListQueryOptions(countKey),
    queryKey: listKey,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      readJson<CursorListPage<TRow>>(path, { pagination: 'cursor', limit: String(CURSOR_PAGE_LIMIT), ...params, cursor: pageParam }, signal),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  })
  // `static`: the count is read on open, on a filter change and on explicit refresh only, never by realtime or focus.
  const count = useQuery({
    queryKey: countKey,
    enabled,
    staleTime: 'static',
    queryFn: ({ signal }) => readJson<CappedListCount>(countPath, countParams, signal),
  })

  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data])
  const settled = list.data !== undefined
  const tableProps = {
    isLoading: list.isPending,
    isPending: list.isPending,
    isFetching: list.isFetching,
    isPlaceholderData: list.isPlaceholderData,
    isError: list.isError && !list.isFetchNextPageError,
    onRetry: () => void list.refetch(),
    hasUsableData: settled,
    listSnapshotResolved: settled || count.data !== undefined,
    infinite: {
      queryKey: listKey,
      hasNextPage: list.hasNextPage,
      isFetchingNextPage: list.isFetchingNextPage,
      isFetchNextPageError: list.isFetchNextPageError,
      fetchNextPage: list.fetchNextPage,
      totalCount: count.data,
      isCountError: count.isError,
      retryCount: () => void count.refetch(),
    },
  }
  return { rows, dataUpdatedAt: list.dataUpdatedAt, tableProps }
}
