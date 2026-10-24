import { hashKey } from '@tanstack/react-query'
import type { Mutation, MutationFunctionContext, QueryKey } from '@tanstack/react-query'

export type QueryKeyResolver<TVariables> = QueryKey | ((variables: TVariables) => QueryKey)

export type ExtraOptimisticCache<TVariables> = {
  queryKey: (variables: TVariables) => QueryKey
  apply: (cache: unknown, variables: TVariables) => unknown
  revert: (cache: unknown, variables: TVariables, snapshot: unknown) => unknown
}

type OptimisticMutationConfig<TCache, TVariables> = {
  /** Query whose cached data the mutation patches optimistically. */
  queryKey: QueryKeyResolver<TVariables>
  /**
   * Must start with `queryKey` (e.g. `[...queryKey, 'assign']`): pending mutations are looked up by `queryKey`,
   * and `RealtimeDashboardSyncProvider` defers echo refetches of every query key that prefixes a pending mutation key.
   */
  mutationKey: QueryKey
  /** Id of the entity (card, row) a mutation changes; a failure does not revert while a newer mutation of it is pending. */
  entityId: (variables: TVariables) => string
  /** Pure: the cache as it should look while the request is in flight. */
  apply: (cache: TCache, variables: TVariables) => TCache
  /**
   * Pure: undo `apply` after a failure. `cache` is the current cache (it may already hold newer
   * optimistic changes), `snapshot` the cache before `apply`. Restore only what `apply` changed, so a
   * failure never clobbers another entity.
   */
  revert: (cache: TCache, variables: TVariables, snapshot: TCache) => TCache
  /** Optional extra caches patched in the same mutation (e.g. order detail while assigning the board). */
  extraCaches?: ExtraOptimisticCache<TVariables>[]
  /** When false, skips cancel/snapshot/apply (mutation still uses scope and settle invalidation). */
  shouldOptimistic?: (variables: TVariables) => boolean
}

type ExtraSnapshot = { queryKey: QueryKey; snapshot: unknown }

type OptimisticContext<TCache> = {
  snapshot: TCache | undefined
  resolvedQueryKey: QueryKey
  extraSnapshots: ExtraSnapshot[]
  skipped?: boolean
}

function resolveQueryKey<TVariables>(
  key: QueryKeyResolver<TVariables>,
  variables: TVariables,
): QueryKey {
  return typeof key === 'function' ? key(variables) : key
}

function revertExtraCaches<TVariables>(
  client: MutationFunctionContext['client'],
  variables: TVariables,
  extraSnapshots: ExtraSnapshot[],
  extraCaches: ExtraOptimisticCache<TVariables>[] | undefined,
) {
  for (const [index, { queryKey: extraKey, snapshot: extraSnapshot }] of extraSnapshots.entries()) {
    const extra = extraCaches?.[index]
    if (!extra || extraSnapshot === undefined) continue
    client.setQueryData(extraKey, (cache) =>
      cache === undefined ? cache : extra.revert(cache, variables, extraSnapshot),
    )
  }
}

function getOptimisticMutationContext(mutation: Mutation): OptimisticContext<unknown> | undefined {
  return mutation.state.context as OptimisticContext<unknown> | undefined
}

function mutationTouchesQueryKey(mutation: Mutation, queryKey: QueryKey): boolean {
  const ctx = getOptimisticMutationContext(mutation)
  if (!ctx) return false
  const target = hashKey(queryKey)
  if (ctx.resolvedQueryKey !== undefined && hashKey(ctx.resolvedQueryKey) === target) return true
  return ctx.extraSnapshots.some((extra) => hashKey(extra.queryKey) === target)
}

function countOtherPendingMutationsForQueryKey(
  client: MutationFunctionContext['client'],
  queryKey: QueryKey,
  exceptMutationId?: number,
): number {
  return client
    .getMutationCache()
    .getAll()
    .filter((mutation) => {
      if (mutation.state.status !== 'pending') return false
      if (exceptMutationId !== undefined && mutation.mutationId === exceptMutationId) return false
      return mutationTouchesQueryKey(mutation, queryKey)
    }).length
}

function findSettlingMutationId(
  client: MutationFunctionContext['client'],
  key: QueryKey,
  variables: unknown,
  context: OptimisticContext<unknown> | undefined,
): number | undefined {
  return client
    .getMutationCache()
    .getAll()
    .find(
      (mutation) =>
        mutation.state.status === 'pending' &&
        hashKey(mutation.options.mutationKey as QueryKey) === hashKey(key) &&
        mutation.state.variables === variables &&
        mutation.state.context === context,
    )?.mutationId
}

function invalidateSettledCaches(
  client: MutationFunctionContext['client'],
  resolvedQueryKey: QueryKey,
  extraSnapshots: ExtraSnapshot[],
  exceptMutationId?: number,
) {
  if (countOtherPendingMutationsForQueryKey(client, resolvedQueryKey, exceptMutationId) === 0) {
    void client.invalidateQueries({ queryKey: resolvedQueryKey })
  }
  for (const { queryKey: extraKey } of extraSnapshots) {
    if (countOtherPendingMutationsForQueryKey(client, extraKey, exceptMutationId) > 0) continue
    void client.invalidateQueries({ queryKey: extraKey })
  }
}

/**
 * Socket-echo-safe optimistic update for `useMutation`. Spread the result next to `mutationFn`:
 *
 * - `onMutate`: cancels in-flight fetches of `queryKey` (a stale response can no longer overwrite the
 *   optimistic state), snapshots the cache and applies `apply`.
 * - `onError`: `revert`s this mutation's change, unless a newer pending mutation of the same entity owns it.
 *   Showing a toast is up to the caller.
 * - `onSettled`: refetches `queryKey`, but only once the last pending mutation under `queryKey` has settled.
 * - Mutations of one `mutationKey` run one after another (`scope`), so the server sees the user's order.
 *
 * Do not pass your own `onMutate`/`onError`/`onSettled` after the spread (they would replace these), and do not
 * invalidate `queryKey` in `onSuccess` (that refetch would overwrite a newer optimistic move).
 *
 * Use `mutateAsync(...).catch(...)` for per-call error handling: callbacks passed to `mutate()` only
 * fire for the latest call of a hook instance.
 *
 * @example
 * // AUT-690: optimistic status change of one row in a list cache
 * useMutation({
 *   ...optimisticMutationOptions<Row[], { id: string; status: Status }>({
 *     queryKey: rowKeys.list(),
 *     mutationKey: [...rowKeys.list(), 'status'],
 *     entityId: ({ id }) => id,
 *     apply: (rows, { id, status }) => rows.map((r) => (r.id === id ? { ...r, status } : r)),
 *     revert: (rows, { id, status }, before) => {
 *       const prev = before.find((b) => b.id === id)
 *       return prev ? rows.map((r) => (r.id === id ? { ...r, status: prev.status } : r)) : rows
 *     },
 *   }),
 *   mutationFn: patchStatus,
 * })
 */
export function optimisticMutationOptions<TCache, TVariables>({
  queryKey,
  mutationKey,
  entityId,
  apply,
  revert,
  extraCaches,
  shouldOptimistic,
}: OptimisticMutationConfig<TCache, TVariables>) {
  return {
    mutationKey,
    scope: { id: hashKey(mutationKey) },
    onMutate: async (
      variables: TVariables,
      { client }: MutationFunctionContext,
    ) => {
      const resolvedQueryKey = resolveQueryKey(queryKey, variables)
      if (shouldOptimistic && !shouldOptimistic(variables)) {
        return {
          snapshot: undefined,
          resolvedQueryKey,
          extraSnapshots: [],
          skipped: true,
        } satisfies OptimisticContext<TCache>
      }

      await client.cancelQueries({ queryKey: resolvedQueryKey })
      const snapshot = client.getQueryData<TCache>(resolvedQueryKey)
      client.setQueryData<TCache>(resolvedQueryKey, (cache) =>
        cache === undefined ? cache : apply(cache, variables),
      )

      const extraSnapshots: ExtraSnapshot[] = []
      for (const extra of extraCaches ?? []) {
        const extraKey = extra.queryKey(variables)
        await client.cancelQueries({ queryKey: extraKey })
        const extraSnapshot = client.getQueryData(extraKey)
        extraSnapshots.push({ queryKey: extraKey, snapshot: extraSnapshot })
        client.setQueryData(extraKey, (cache) =>
          cache === undefined ? cache : extra.apply(cache, variables),
        )
      }

      return { snapshot, resolvedQueryKey, extraSnapshots } satisfies OptimisticContext<TCache>
    },
    onError: (
      _error: unknown,
      variables: TVariables,
      context: OptimisticContext<TCache> | undefined,
      { client }: MutationFunctionContext,
    ) => {
      if (!context || context.skipped) return
      const snapshot = context.snapshot
      const id = entityId(variables)
      const sameEntityOptimistic = (mutation: Mutation) => {
        const ctx = getOptimisticMutationContext(mutation)
        if (ctx?.skipped) return false
        return entityId(mutation.state.variables as TVariables) === id
      }
      if (client.isMutating({ mutationKey, exact: true, predicate: sameEntityOptimistic }) > 1) return

      if (snapshot !== undefined) {
        client.setQueryData<TCache>(context.resolvedQueryKey, (cache) =>
          cache === undefined ? cache : revert(cache, variables, snapshot),
        )
      }

      revertExtraCaches(client, variables, context.extraSnapshots, extraCaches)
    },
    onSettled: (
      _data: unknown,
      _error: unknown,
      variables: TVariables,
      context: OptimisticContext<TCache> | undefined,
      { client }: MutationFunctionContext,
    ) => {
      const resolvedQueryKey = context?.resolvedQueryKey ?? resolveQueryKey(queryKey, variables)
      const extraSnapshots = context?.skipped ? [] : (context?.extraSnapshots ?? [])
      const settlingMutationId = findSettlingMutationId(
        client,
        mutationKey,
        variables,
        context as OptimisticContext<unknown> | undefined,
      )
      invalidateSettledCaches(client, resolvedQueryKey, extraSnapshots, settlingMutationId)
    },
  }
}
