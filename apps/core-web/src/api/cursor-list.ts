import {
  CancelledError,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  useScopeContextDigest,
  useScopeContextQuarantined,
  useScopeContextReady,
  useScopeExplicitRefreshRequired,
} from '@/auth/use-scope-context-digest'
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

function restartListFetchSignal(_querySignal: AbortSignal): AbortSignal {
  return new AbortController().signal
}

async function fetchListPageAfterRecovery<TRow>(
  path: string,
  cursorParams: QueryParams,
  _querySignal: AbortSignal,
  expectedScopeDigest?: string,
): Promise<CursorListPage<TRow>> {
  return fetchCursorListPage<TRow>(
    urlOf(path, { ...cursorParams, cursor: undefined }),
    new AbortController().signal,
    { expectedScopeDigest },
  )
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
  expectedScopeDigest?: string,
): Promise<CappedListCount> {
  if (signal.aborted) throwQueryAborted()
  const count = await fetchCursorListCount<CappedListCount>(
    urlOf(countPath, countParams),
    restartListFetchSignal(signal),
    { expectedScopeDigest },
  )
  if (signal.aborted) throwQueryAborted()
  return count
}

async function handleListQueryRecovery<TRow>(
  client: QueryClient,
  ctx: RecoveryQueryContext,
  error: unknown,
  restart: () => Promise<CursorListPage<TRow>>,
  pageParam: string | undefined,
): Promise<CursorListPage<TRow>> {
  assertCursorListApiError(error)
  const outcome = await recoverCursorListFailure(client, ctx, error)
  if (outcome.type === 'restart-page-one') {
    if (pageParam !== undefined) {
      const pageOne = await restart()
      client.setQueryData(ctx.listKey, { pages: [pageOne], pageParams: [undefined as string | undefined] })
      throw new CancelledError({ revert: false })
    }
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
  const expectedScopeDigest = typeof listKey.at(-1) === 'string' ? String(listKey.at(-1)) : undefined
  try {
    return await fetchCursorListPage<TRow>(urlOf(path, cursorParams), signal, { expectedScopeDigest })
  } catch (error) {
    return handleListQueryRecovery(
      queryClient,
      recoveryCtx,
      error,
      () => fetchListPageAfterRecovery<TRow>(path, cursorParams, signal, expectedScopeDigest),
      pageParam,
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
  const expectedScopeDigest = typeof countKey.at(-1) === 'string' ? String(countKey.at(-1)) : undefined
  try {
    return await fetchCursorListCount<CappedListCount>(urlOf(countPath, countParams), signal, { expectedScopeDigest })
  } catch (error) {
    return handleCountQueryRecovery(client, recoveryCtx, error, () =>
      fetchCountAfterRecovery(countPath, countParams, signal, expectedScopeDigest),
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

type RetryableQuery = { isError: boolean; refetch: () => Promise<unknown> }

/** A blocked list (403, scope quarantine, pending explicit refresh) would resend the same request on retry: no retry
 * controls then, only "Liste aktualisieren". */
function retryControls(list: RetryableQuery & { isFetchNextPageError: boolean }, count: RetryableQuery, blocked: boolean) {
  if (blocked) return { isError: false, onRetry: undefined, isCountError: false, retryCount: undefined }
  return {
    isError: list.isError && !list.isFetchNextPageError,
    onRetry: () => void list.refetch(),
    isCountError: count.isError,
    retryCount: () => void count.refetch(),
  }
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
  const explicitRefreshRequired = useScopeExplicitRefreshRequired()
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
    if (quarantined || authBlocked) return []
    return list.data?.pages.flatMap((page) => page.data) ?? []
  }, [list.data, quarantined, authBlocked])
  const retry = retryControls(list, count, authBlocked || quarantined || explicitRefreshRequired)
  const tableProps = {
    // Before the first handshake the query is disabled and idle; keep the skeleton instead of "Keine Ergebnisse.".
    isLoading: list.isLoading || (enabled && !scopeReady),
    isFetching: list.isFetching,
    isPlaceholderData: list.isPlaceholderData,
    isError: retry.isError,
    onRetry: retry.onRetry,
    hasUsableData: rows.length > 0,
    scopeOffsetLatch: offsetLatch,
    infinite: {
      queryKey: scopedListKey,
      hasNextPage: list.hasNextPage,
      isFetchingNextPage: list.isFetchingNextPage,
      isFetchNextPageError: list.isFetchNextPageError,
      fetchNextPage: list.fetchNextPage,
      totalCount: authBlocked ? undefined : count.data,
      isCountError: retry.isCountError,
      retryCount: retry.retryCount,
    },
  }
  return { rows, dataUpdatedAt: list.dataUpdatedAt, tableProps }
}
