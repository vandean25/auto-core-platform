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

function sameRowIds(before: readonly string[] | undefined, after: readonly string[] | undefined): boolean {
  if (before === undefined || after === undefined || before.length !== after.length) return false
  return before.every((id, index) => id === after[index])
}

/** First snapshot pages must keep their ids. Pages appended after that are a later fetch, not an insert. */
function retainedPagesKeepMembership(snapshot: unknown, current: unknown): boolean {
  if (!isInfiniteDataShape(snapshot) || !isInfiniteDataShape(current)) return false
  if (current.pages.length < snapshot.pages.length) return false
  return snapshot.pages.every((page, index) =>
    sameRowIds(rowIdsFromRows(extractRowArray(page)), rowIdsFromRows(extractRowArray(current.pages[index]))),
  )
}

export function isInfiniteListQuery(client: QueryClient, queryKey: QueryKey): boolean {
  const query = client.getQueryCache().find({ queryKey, exact: true })
  if (readInfiniteListMeta(query) !== undefined) return true
  return isInfiniteDataShape(query?.state.data)
}

export function markInfiniteListStale(client: QueryClient, queryKey: QueryKey) {
  void client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' })
}

const membershipDrift = new WeakMap<QueryClient, Map<string, unknown>>()

function membershipDriftFor(client: QueryClient): Map<string, unknown> {
  const existing = membershipDrift.get(client)
  if (existing) return existing
  const map = new Map<string, unknown>()
  membershipDrift.set(client, map)
  client.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') map.delete(hashKey(event.query.queryKey))
  })
  return map
}

/** Remember the cache from before the first membership change while later mutations are still pending. */
export function noteInfiniteMembershipDrift(client: QueryClient, queryKey: QueryKey, snapshot: unknown) {
  if (!isInfiniteDataShape(snapshot)) return
  if (retainedPagesKeepMembership(snapshot, client.getQueryData(queryKey))) return
  const map = membershipDriftFor(client)
  const key = hashKey(queryKey)
  if (!map.has(key)) map.set(key, snapshot)
}

export function takeInfiniteMembershipDrift(client: QueryClient, queryKey: QueryKey): unknown | undefined {
  const map = membershipDrift.get(client)
  if (!map) return undefined
  const key = hashKey(queryKey)
  const snapshot = map.get(key)
  map.delete(key)
  return snapshot
}

function initialPageParamOf(query: Query): unknown {
  return (query.options as { initialPageParam?: unknown }).initialPageParam
}

async function readFirstPage(client: QueryClient, query: Query): Promise<unknown> {
  const queryFn = query.options.queryFn
  if (typeof queryFn !== 'function') return undefined
  const pageFn = queryFn as QueryFunction<unknown, QueryKey, unknown>
  const controller = new AbortController()
  return pageFn({
    client,
    queryKey: query.queryKey,
    signal: controller.signal,
    meta: query.meta,
    pageParam: initialPageParamOf(query),
    direction: 'forward',
  })
}

async function refetchCountQuery(client: QueryClient, countQueryKey: QueryKey | undefined) {
  if (countQueryKey === undefined) return
  const countQuery = client.getQueryCache().find({ queryKey: countQueryKey, exact: true })
  const countQueryFn = countQuery?.options.queryFn
  if (!countQuery || typeof countQueryFn !== 'function') return
  await client.fetchQuery({
    queryKey: countQueryKey,
    queryFn: countQueryFn,
    meta: countQuery.meta,
  })
}

export async function refreshInfiniteList(client: QueryClient, queryKey: QueryKey) {
  const query = client.getQueryCache().find({ queryKey, exact: true })
  if (!query) return
  const countQueryKey = readInfiniteListMeta(query)?.countQueryKey

  await client.cancelQueries({ queryKey, exact: true })
  if (countQueryKey !== undefined) {
    await client.cancelQueries({ queryKey: countQueryKey, exact: true })
  }

  const page = await readFirstPage(client, query)
  if (page === undefined) return
  await refetchCountQuery(client, countQueryKey)
  client.setQueryData(queryKey, {
    pages: [page],
    pageParams: [initialPageParamOf(query)],
  })
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

  if (retainedPagesKeepMembership(snapshot, current)) {
    return 'field-only'
  }

  if (snapshot !== undefined && beforeIds !== undefined && afterIds !== undefined) {
    // A stale snapshot beats a silent reorder, including pages loaded while this mutation was in flight.
    client.setQueryData(queryKey, snapshot)
    markInfiniteListStale(client, queryKey)
    return 'reverted-and-stale'
  }

  markInfiniteListStale(client, queryKey)
  return 'stale'
}
