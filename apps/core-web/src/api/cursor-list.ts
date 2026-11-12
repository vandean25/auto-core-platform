import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  isScopeContextQuarantined,
  scopeContextReadyForCursorList,
} from '@/auth/scope-context-client'
import { useScopeContextDigest, useScopeContextQuarantined, useScopeContextReady } from '@/auth/use-scope-context-digest'
import { infiniteListQueryOptions } from '@/lib/infinite-list-query'
import type { components } from './generated/openapi'
import { fetchCursorListCount, fetchCursorListPage } from './cursor-list-fetch'
import {
  cursorQueryShouldRetry,
  isAuthBlockedForEpisode,
  isOffsetLatchedForEpisode,
  resolveCursorListFailure,
} from './cursor-recovery'
import { isCursorListApiError } from './cursor-list-api-error'

/** Rows per block. Vehicle stock caps a page at 50, the API's smallest ceiling (ADR-0035). */
export const CURSOR_PAGE_LIMIT = 50

export type CappedListCount = components['schemas']['CappedListCountResponseDto']
type CursorListPage<TRow> = { data: TRow[]; meta: { nextCursor: string | null; hasNextPage: boolean } }
type QueryParams = Record<string, string | undefined>

function restartListFetchSignal(querySignal: AbortSignal): AbortSignal {
  return querySignal.aborted ? querySignal : new AbortController().signal
}

async function fetchListPageAfterRecovery<TRow>(
  path: string,
  cursorParams: QueryParams,
  querySignal: AbortSignal,
): Promise<CursorListPage<TRow>> {
  if (querySignal.aborted) {
    throw new DOMException('Query aborted', 'AbortError')
  }
  const page = await fetchCursorListPage<TRow>(
    urlOf(path, { ...cursorParams, cursor: undefined }),
    restartListFetchSignal(querySignal),
  )
  if (querySignal.aborted) {
    throw new DOMException('Query aborted', 'AbortError')
  }
  return page
}

function urlOf(path: string, params: QueryParams) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

async function runListQuery<TRow>(
  client: QueryClient,
  options: {
    path: string
    params: QueryParams
    pageParam: string | undefined
    signal: AbortSignal
    semanticEpisodeKey: string
    listKey: QueryKey
    countKey: QueryKey
  },
): Promise<CursorListPage<TRow>> {
  const { path, params, pageParam, signal, semanticEpisodeKey, listKey, countKey } = options
  const queryClient = client
  const cursorParams = {
    pagination: 'cursor',
    limit: String(CURSOR_PAGE_LIMIT),
    ...params,
    cursor: pageParam,
  }

  try {
    return await fetchCursorListPage<TRow>(urlOf(path, cursorParams), signal)
  } catch (error) {
    if (error instanceof Error && error.message === 'stale_scope_context_response') {
      throw error
    }
    if (!isCursorListApiError(error)) throw error
    const outcome = await resolveCursorListFailure(queryClient, {
      error,
      semanticKey: semanticEpisodeKey,
      listKey,
      countKey,
      contextValid: scopeContextReadyForCursorList() && !isScopeContextQuarantined(),
    })
    if (outcome.type === 'restart-page-one') {
      return fetchListPageAfterRecovery<TRow>(path, cursorParams, signal)
    }
    if (outcome.type === 'offset-latch') {
      throw error
    }
    if (outcome.type === 'blocked' || outcome.type === 'throw') {
      throw error
    }
    throw outcome.error
  }
}

async function runCountQuery(
  client: QueryClient,
  options: {
    countPath: string
    countParams: QueryParams
    signal: AbortSignal
    semanticEpisodeKey: string
    listKey: QueryKey
    countKey: QueryKey
  },
): Promise<CappedListCount> {
  const { countPath, countParams, signal, semanticEpisodeKey, listKey, countKey } = options
  try {
    return await fetchCursorListCount<CappedListCount>(urlOf(countPath, countParams), signal)
  } catch (error) {
    if (error instanceof Error && error.message === 'stale_scope_context_response') {
      throw error
    }
    if (!isCursorListApiError(error)) throw error
    const outcome = await resolveCursorListFailure(client, {
      error,
      semanticKey: semanticEpisodeKey,
      listKey,
      countKey,
      contextValid: scopeContextReadyForCursorList() && !isScopeContextQuarantined(),
    })
    if (outcome.type === 'restart-page-one') {
      if (signal.aborted) throw new DOMException('Query aborted', 'AbortError')
      const count = await fetchCursorListCount<CappedListCount>(
        urlOf(countPath, countParams),
        restartListFetchSignal(signal),
      )
      if (signal.aborted) throw new DOMException('Query aborted', 'AbortError')
      return count
    }
    if (outcome.type === 'blocked' || outcome.type === 'throw' || outcome.type === 'pass-through') {
      throw error
    }
    throw error
  }
}

type CursorListOptions = {
  enabled: boolean
  /** List endpoint and its separate capped-count endpoint (ADR-0035 §5). */
  path: string
  countPath: string
  /** Stable semantic key for the episode budget (filters + sort), without the scope digest. */
  semanticEpisodeKey: string
  /** The list key carries filters and sort (a change restarts the chain); the count key carries the filters only. */
  listKey: QueryKey
  countKey: QueryKey
  params: QueryParams
  countParams: QueryParams
}

function scopeScopedKey(base: QueryKey, digest: string | undefined): QueryKey {
  if (!digest) return base
  return [...base, digest] as const
}

/**
 * Cursor-paged list plus capped count for a migrated ADR-0035 DataTable. `tableProps` spreads onto `<DataTable>`;
 * with `enabled: false` (offset mode) nothing is requested and the offset hook of the page stays in charge.
 */
export function useCursorList<TRow extends { id: string }>({
  enabled,
  path,
  countPath,
  semanticEpisodeKey,
  listKey,
  countKey,
  params,
  countParams,
}: CursorListOptions) {
  const queryClient = useQueryClient()
  const digest = useScopeContextDigest()
  const scopeReady = useScopeContextReady()
  const quarantined = useScopeContextQuarantined()
  const offsetLatch = isOffsetLatchedForEpisode(semanticEpisodeKey)
  const scopedListKey = useMemo(() => scopeScopedKey(listKey, digest), [digest, listKey])
  const scopedCountKey = useMemo(() => scopeScopedKey(countKey, digest), [digest, countKey])
  const authBlocked = isAuthBlockedForEpisode(semanticEpisodeKey)
  const queryEnabled = enabled && scopeReady && !offsetLatch && !quarantined && !authBlocked

  const list = useInfiniteQuery({
    ...infiniteListQueryOptions(scopedCountKey),
    queryKey: scopedListKey,
    enabled: queryEnabled,
    initialPageParam: undefined as string | undefined,
    retry: cursorQueryShouldRetry,
    queryFn: ({ pageParam, signal }) =>
      runListQuery<TRow>(queryClient, {
        path,
        params,
        pageParam,
        signal,
        semanticEpisodeKey,
        listKey: scopedListKey,
        countKey: scopedCountKey,
      }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  })

  const count = useQuery({
    queryKey: scopedCountKey,
    enabled: queryEnabled,
    staleTime: 'static',
    retry: cursorQueryShouldRetry,
    queryFn: ({ signal }) =>
      runCountQuery(queryClient, {
        countPath,
        countParams,
        signal,
        semanticEpisodeKey,
        listKey: scopedListKey,
        countKey: scopedCountKey,
      }),
  })

  const rows = useMemo(() => {
    if (quarantined) return []
    return list.data?.pages.flatMap((page) => page.data) ?? []
  }, [list.data, quarantined])
  const tableProps = {
    isLoading: list.isLoading,
    isFetching: list.isFetching,
    isPlaceholderData: list.isPlaceholderData,
    isError: list.isError && !list.isFetchNextPageError && !authBlocked,
    onRetry: authBlocked ? undefined : () => void list.refetch(),
    hasUsableData: rows.length > 0,
    scopeOffsetLatch: offsetLatch,
    infinite: {
      queryKey: scopedListKey,
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
