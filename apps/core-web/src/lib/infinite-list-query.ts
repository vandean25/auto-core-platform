import type { InfiniteData, Query, QueryClient, QueryFunction, QueryKey } from '@tanstack/react-query'
import { hashKey, keepPreviousData } from '@tanstack/react-query'

/** ADR-0035: loaded rows per result list; beyond this the user refines the filter instead of scrolling on. */
export const INFINITE_LIST_ROW_CAP = 2000

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

/** After this age a cached list that is mounted again, or whose tab regains focus, offers "Liste aktualisieren". */
export const INFINITE_LIST_OUTDATED_AFTER_MS = 5 * 60 * 1000

/**
 * Spread into `useInfiniteQuery` of a migrated list. `staleTime: 'static'` makes query-core skip the query in every
 * automatic refetch (invalidation by realtime or a mutation, mount, focus, reconnect) while still flagging it as
 * invalidated, which is what the DataTable turns into "Liste aktualisieren" (ADR-0035 §7). The previous rows stay as
 * a locked preview while a new chain loads.
 */
export const infiniteListQueryOptions = (countQueryKey?: QueryKey) => ({
  meta: infiniteListQueryMeta(countQueryKey),
  staleTime: 'static' as const,
  placeholderData: keepPreviousData,
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

/**
 * A page landing (`success`) clears the invalidated flag, and query-core ignores an invalidation of an already invalidated
 * query. So a list that was stale when a load began, or that was invalidated during it, would silently become "fresh".
 * This restores the flag after such a load. A cancelled load reverts the state itself (`setState`), and a manual
 * `setQueryData` (explicit refresh) is not a load, so neither restores anything. Returns the unsubscribe function.
 */
type FetchPhase = 'start' | 'invalidated' | 'reset' | 'end' | 'other'

function fetchPhaseOf(action: { type: string; manual?: boolean }): FetchPhase {
  if (action.type === 'fetch') return 'start'
  if (action.type === 'invalidate') return 'invalidated'
  if (action.type === 'setState' || (action.type === 'success' && action.manual)) return 'reset'
  return action.type === 'success' || action.type === 'error' ? 'end' : 'other'
}

export function keepStaleAcrossFetch(client: QueryClient, queryKey: QueryKey) {
  const hash = hashKey(queryKey)
  let staleDuringFetch = false
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryHash !== hash) return
    const { query } = event
    switch (fetchPhaseOf(event.action)) {
      case 'start':
        staleDuringFetch = query.state.isInvalidated
        break
      case 'invalidated':
        staleDuringFetch ||= query.state.fetchStatus === 'fetching'
        break
      case 'reset':
        staleDuringFetch = false
        break
      case 'end': {
        const restore = staleDuringFetch
        staleDuringFetch = false
        if (restore) query.invalidate()
        break
      }
    }
  })
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

const refreshEpochs = new WeakMap<QueryClient, Map<string, number>>()

/** Counts the explicit refreshes that discarded this list's cursor chain. A mutation records it when it starts. */
export function infiniteListRefreshEpoch(client: QueryClient, queryKey: QueryKey): number {
  return refreshEpochs.get(client)?.get(hashKey(queryKey)) ?? 0
}

/** True when an explicit refresh replaced the chain after `epoch` was recorded; the refresh then wins over that snapshot. */
export function isSupersededByRefresh(client: QueryClient, queryKey: QueryKey, epoch: number | undefined): boolean {
  return epoch !== undefined && epoch !== infiniteListRefreshEpoch(client, queryKey)
}

function startNewRefreshEpoch(client: QueryClient, queryKey: QueryKey) {
  const epochs = refreshEpochs.get(client) ?? new Map<string, number>()
  refreshEpochs.set(client, epochs)
  epochs.set(hashKey(queryKey), infiniteListRefreshEpoch(client, queryKey) + 1)
  // Drift remembered from before the refresh describes the discarded chain.
  membershipDriftFor(client).delete(hashKey(queryKey))
}

function initialPageParamOf(query: Query): unknown {
  return (query.options as { initialPageParam?: unknown }).initialPageParam
}

async function readFirstPage(client: QueryClient, query: Query, signal: AbortSignal): Promise<unknown> {
  const queryFn = query.options.queryFn
  if (typeof queryFn !== 'function') return undefined
  const pageFn = queryFn as QueryFunction<unknown, QueryKey, unknown>
  return pageFn({
    client,
    queryKey: query.queryKey,
    signal,
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

const refreshControllers = new WeakMap<QueryClient, Map<string, AbortController>>()

/** Aborts the page-one read of a running explicit refresh of this list, if any. */
function abortRefresh(client: QueryClient, queryKey: QueryKey) {
  refreshControllers.get(client)?.get(hashKey(queryKey))?.abort()
}

/** Aborts everything in flight for a list whose chain is being left (pages, count and a running refresh). */
export async function cancelInfiniteList(client: QueryClient, queryKey: QueryKey) {
  abortRefresh(client, queryKey)
  const countQueryKey = readInfiniteListMeta(client.getQueryCache().find({ queryKey, exact: true }))?.countQueryKey
  await client.cancelQueries({ queryKey, exact: true })
  if (countQueryKey !== undefined) await client.cancelQueries({ queryKey: countQueryKey, exact: true })
}

/** Records whether an invalidation reaches the list while it refreshes; setQueryData would clear it. */
function watchInvalidations(client: QueryClient, query: Query) {
  const watcher = { seen: false, stop: () => unsubscribe() }
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.query === query && event.type === 'updated' && event.action.type === 'invalidate') watcher.seen = true
  })
  return watcher
}

export async function refreshInfiniteList(client: QueryClient, queryKey: QueryKey, { withCount = true } = {}) {
  const query = client.getQueryCache().find({ queryKey, exact: true })
  if (!query) return
  const countQueryKey = readInfiniteListMeta(query)?.countQueryKey

  await cancelInfiniteList(client, queryKey)
  const controller = new AbortController()
  const controllers = refreshControllers.get(client) ?? new Map<string, AbortController>()
  refreshControllers.set(client, controllers)
  controllers.set(hashKey(queryKey), controller)

  // Cleared first so an event arriving during the refresh is distinguishable from the one that made the user refresh.
  query.setState({ isInvalidated: false })
  const watcher = watchInvalidations(client, query)
  let page: unknown
  try {
    page = await readFirstPage(client, query, controller.signal)
    if (withCount && page !== undefined && !controller.signal.aborted) await refetchCountQuery(client, countQueryKey)
  } catch (error) {
    // A superseded refresh (new filter, newer refresh) is not a failure; a real failure leaves the list marked stale.
    if (controller.signal.aborted) return
    markInfiniteListStale(client, queryKey)
    throw error
  } finally {
    watcher.stop()
    if (controllers.get(hashKey(queryKey)) === controller) controllers.delete(hashKey(queryKey))
  }
  if (page === undefined || controller.signal.aborted) return
  startNewRefreshEpoch(client, queryKey)
  client.setQueryData(queryKey, {
    pages: [page],
    pageParams: [initialPageParamOf(query)],
  })
  if (watcher.seen) markInfiniteListStale(client, queryKey)
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
