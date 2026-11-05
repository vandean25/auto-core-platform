import type { InfiniteData, Query, QueryClient, QueryFunction, QueryKey } from '@tanstack/react-query'
import { hashKey } from '@tanstack/react-query'

/** TanStack Query `meta` flag for migrated ADR-0035 infinite lists. */
export type InfiniteListQueryMeta = {
  listPagination: 'infinite'
  /** Separate capped-count query invalidated on explicit refresh. */
  countQueryKey?: QueryKey
}

export const infiniteListQueryMeta = (
  countQueryKey?: QueryKey,
): InfiniteListQueryMeta => ({
  listPagination: 'infinite',
  ...(countQueryKey !== undefined ? { countQueryKey } : {}),
})

function readInfiniteListMeta(query: Query | undefined): InfiniteListQueryMeta | undefined {
  const meta = query?.meta
  if (meta && typeof meta === 'object' && (meta as InfiniteListQueryMeta).listPagination === 'infinite') {
    return meta as InfiniteListQueryMeta
  }
  return undefined
}

export function isInfiniteDataShape(data: unknown): data is InfiniteData<unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'pages' in data &&
    'pageParams' in data &&
    Array.isArray((data as InfiniteData<unknown>).pages) &&
    Array.isArray((data as InfiniteData<unknown>).pageParams)
  )
}

function rowIdsFromRows(rows: Array<{ id: string }> | undefined): readonly string[] | undefined {
  if (!rows) return undefined
  if (!rows.every((row) => typeof row.id === 'string')) return undefined
  return rows.map((row) => row.id)
}

function rowIdsFromInfinitePages(pages: unknown[]): readonly string[] | undefined {
  const ids: string[] = []
  for (const page of pages) {
    const pageIds = rowIdsFromRows(extractRowArray(page))
    if (!pageIds) return undefined
    ids.push(...pageIds)
  }
  return ids
}

/** Reads stable row ids from infinite pages or offset `{ data: { id }[] }` list caches. */
export function listRowIdsFromCache(cache: unknown): readonly string[] | undefined {
  if (cache === undefined || cache === null) return undefined
  if (isInfiniteDataShape(cache)) {
    return rowIdsFromInfinitePages(cache.pages)
  }
  return rowIdsFromRows(extractRowArray(cache))
}

function extractRowArray(value: unknown): Array<{ id: string }> | undefined {
  if (Array.isArray(value)) {
    return value as Array<{ id: string }>
  }
  if (typeof value === 'object' && value !== null && 'data' in value) {
    const data = (value as { data: unknown }).data
    if (Array.isArray(data)) {
      return data as Array<{ id: string }>
    }
  }
  return undefined
}

export function rowIdsPreserveMembershipAndOrder(
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
): boolean {
  if (before === undefined || after === undefined) return false
  if (before.length !== after.length) return false
  return before.every((id, index) => id === after[index])
}

export function isInfiniteListQuery(client: QueryClient, queryKey: QueryKey): boolean {
  const query = client.getQueryCache().find({ queryKey, exact: true })
  if (readInfiniteListMeta(query) !== undefined) return true
  return isInfiniteDataShape(query?.state.data)
}

const staleListKeys = new Set<string>()
const staleListeners = new Set<() => void>()

function notifyStaleListeners() {
  for (const listener of staleListeners) {
    listener()
  }
}

export function subscribeInfiniteListStale(onStoreChange: () => void): () => void {
  staleListeners.add(onStoreChange)
  return () => {
    staleListeners.delete(onStoreChange)
  }
}

export function infiniteListNeedsRefresh(queryKey: QueryKey): boolean {
  return staleListKeys.has(hashKey(queryKey))
}

export function markInfiniteListStale(client: QueryClient, queryKey: QueryKey) {
  staleListKeys.add(hashKey(queryKey))
  void client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' })
  notifyStaleListeners()
}

export function clearInfiniteListStaleNotice(queryKey: QueryKey) {
  if (!staleListKeys.delete(hashKey(queryKey))) return
  notifyStaleListeners()
}

/** @internal test helper */
export function resetInfiniteListStaleStateForTests() {
  staleListKeys.clear()
  notifyStaleListeners()
}

export async function refreshInfiniteList(client: QueryClient, queryKey: QueryKey) {
  const query = client.getQueryCache().find({ queryKey, exact: true })
  const countQueryKey = readInfiniteListMeta(query)?.countQueryKey

  clearInfiniteListStaleNotice(queryKey)
  await client.cancelQueries({ queryKey, exact: true })
  if (countQueryKey !== undefined) {
    await client.cancelQueries({ queryKey: countQueryKey, exact: true })
  }

  const savedInfiniteOptions = query
    ? {
        queryFn: query.options.queryFn,
        initialPageParam: (query.options as { initialPageParam?: unknown }).initialPageParam,
        getNextPageParam: (query.options as { getNextPageParam?: (lastPage: unknown) => unknown })
          .getNextPageParam,
        meta: query.meta,
      }
    : undefined

  if (savedInfiniteOptions?.queryFn && typeof savedInfiniteOptions.queryFn === 'function') {
    client.removeQueries({ queryKey, exact: true })
    await client.fetchInfiniteQuery({
      queryKey,
      queryFn: savedInfiniteOptions.queryFn as QueryFunction<unknown, QueryKey, unknown>,
      initialPageParam: savedInfiniteOptions.initialPageParam as unknown,
      getNextPageParam: savedInfiniteOptions.getNextPageParam as
        | ((lastPage: unknown) => unknown)
        | undefined,
      meta: savedInfiniteOptions.meta,
    })
  }

  if (countQueryKey !== undefined) {
    const countQuery = client.getQueryCache().find({ queryKey: countQueryKey, exact: true })
    const countQueryFn = countQuery?.options.queryFn
    if (countQuery && typeof countQueryFn === 'function') {
      client.removeQueries({ queryKey: countQueryKey, exact: true })
      await client.fetchQuery({
        queryKey: countQueryKey,
        queryFn: countQueryFn,
        meta: countQuery.meta,
      })
    }
  }
}

export type InfiniteListSettlementDecision = 'field-only' | 'stale' | 'reverted-and-stale'

/**
 * ADR-0036 R7 / ADR-0035: infinite lists must not refetch retained pages on mutation settle.
 * Field-only patches that preserve loaded row membership and order may stay visible without stale marking.
 */
export function settleInfiniteListAfterMutation(
  client: QueryClient,
  queryKey: QueryKey,
  snapshot: unknown,
): InfiniteListSettlementDecision {
  const current = client.getQueryData(queryKey)
  const beforeIds = listRowIdsFromCache(snapshot)
  const afterIds = listRowIdsFromCache(current)

  if (rowIdsPreserveMembershipAndOrder(beforeIds, afterIds)) {
    return 'field-only'
  }

  if (snapshot !== undefined && beforeIds !== undefined && afterIds !== undefined) {
    client.setQueryData(queryKey, snapshot)
  }

  markInfiniteListStale(client, queryKey)
  return beforeIds !== undefined && afterIds !== undefined && !rowIdsPreserveMembershipAndOrder(beforeIds, afterIds)
    ? 'reverted-and-stale'
    : 'stale'
}
