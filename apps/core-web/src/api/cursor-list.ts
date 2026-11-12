import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
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
  type CursorRecoveryOutcome,
} from './cursor-recovery'
import { isCursorListApiError, type CursorListApiError } from './cursor-list-api-error'

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

type RecoveryQueryContext = {
  semanticEpisodeKey: string
  listKey: QueryKey
  countKey: QueryKey
}

function throwQueryAborted(): never {
  throw new DOMException('Query aborted', 'AbortError')
}

function assertCursorListApiError(error: unknown): asserts error is CursorListApiError {
  if (error instanceof Error && error.message === 'stale_scope_context_response') {
    throw error
  }
  if (!isCursorListApiError(error)) {
    throw error
  }
}

function recoveryContextValid(): boolean {
  return scopeContextReadyForCursorList() && !isScopeContextQuarantined()
}

async function recoverCursorListFailure(
  client: QueryClient,
  ctx: RecoveryQueryContext,
  error: CursorListApiError,
): Promise<CursorRecoveryOutcome> {
  return resolveCursorListFailure(client, {
    error,
    semanticKey: ctx.semanticEpisodeKey,
    listKey: ctx.listKey,
    countKey: ctx.countKey,
    contextValid: recoveryContextValid(),
  })
}

function throwCursorRecoveryFailure(outcome: CursorRecoveryOutcome, original: CursorListApiError): never {
  if (outcome.type === 'pass-through' || outcome.type === 'throw') {
    throw outcome.error
  }
  throw original
}

async function fetchCountAfterRecovery(
  countPath: string,
  countParams: QueryParams,
  signal: AbortSignal,
): Promise<CappedListCount> {
  if (signal.aborted) throwQueryAborted()
  const count = await fetchCursorListCount<CappedListCount>(
    urlOf(countPath, countParams),
    restartListFetchSignal(signal),
  )
  if (signal.aborted) throwQueryAborted()
  return count
}

async function handleListQueryRecovery<TRow>(
  client: QueryClient,
  ctx: RecoveryQueryContext,
  error: unknown,
  restart: () => Promise<CursorListPage<TRow>>,
): Promise<CursorListPage<TRow>> {
  assertCursorListApiError(error)
  const outcome = await recoverCursorListFailure(client, ctx, error)
  if (outcome.type === 'restart-page-one') {
    return restart()
  }
  throwCursorRecoveryFailure(outcome, error)
}

async function handleCountQueryRecovery(
  client: QueryClient,
  ctx: RecoveryQueryContext,
  error: unknown,
  restart: () => Promise<CappedListCount>,
): Promise<CappedListCount> {
  assertCursorListApiError(error)
  const outcome = await recoverCursorListFailure(client, ctx, error)
  if (outcome.type === 'restart-page-one') {
    return restart()
  }
  throwCursorRecoveryFailure(outcome, error)
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

  const recoveryCtx = { semanticEpisodeKey, listKey, countKey }
  try {
    return await fetchCursorListPage<TRow>(urlOf(path, cursorParams), signal)
  } catch (error) {
    return handleListQueryRecovery(queryClient, recoveryCtx, error, () =>
      fetchListPageAfterRecovery<TRow>(path, cursorParams, signal),
    )
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
  const recoveryCtx = { semanticEpisodeKey, listKey, countKey }
  try {
    return await fetchCursorListCount<CappedListCount>(urlOf(countPath, countParams), signal)
  } catch (error) {
    return handleCountQueryRecovery(client, recoveryCtx, error, () =>
      fetchCountAfterRecovery(countPath, countParams, signal),
    )
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

  const list = useInfiniteQuery<
    CursorListPage<TRow>,
    Error,
    InfiniteData<CursorListPage<TRow>, string | undefined>,
    QueryKey,
    string | undefined
  >({
    ...infiniteListQueryOptions(scopedCountKey),
    queryKey: scopedListKey,
    enabled: queryEnabled,
    placeholderData: (previousData, previousQuery) => {
      const prevDigest = previousQuery?.queryKey.at(-1)
      const nextDigest = scopedListKey.at(-1)
      if (prevDigest !== nextDigest) return undefined
      return previousData
    },
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
