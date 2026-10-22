import { hashKey } from '@tanstack/react-query'
import type { MutationFunctionContext, QueryKey } from '@tanstack/react-query'

type OptimisticMutationConfig<TCache, TVariables> = {
  /** Query whose cached data the mutation patches optimistically. */
  queryKey: QueryKey
  /**
   * Must start with a key the realtime handler invalidates (e.g. `[...queryKey, 'assign']`):
   * `RealtimeDashboardSyncProvider` defers echo refetches of every query key that prefixes a pending mutation key.
   */
  mutationKey: QueryKey
  /** Pure: the cache as it should look while the request is in flight. */
  apply: (cache: TCache, variables: TVariables) => TCache
  /**
   * Pure: undo `apply` after a failure. `cache` is the current cache (it may already hold newer
   * optimistic changes), `snapshot` the cache before `apply`. Restore only what `apply` changed, and
   * only where it is still unchanged, so a failure never clobbers another card's or a newer move.
   */
  revert: (cache: TCache, variables: TVariables, snapshot: TCache) => TCache
}

type OptimisticContext<TCache> = { snapshot: TCache | undefined }

/**
 * Socket-echo-safe optimistic update for `useMutation`. Spread the result next to `mutationFn`:
 *
 * - `onMutate`: cancels in-flight fetches of `queryKey` (a stale response can no longer overwrite the
 *   optimistic state), snapshots the cache and applies `apply`.
 * - `onError`: `revert`s this mutation's change. Showing a toast is up to the caller.
 * - `onSettled`: refetches `queryKey`, but only once the last mutation of this key has settled.
 * - Mutations of one `mutationKey` run one after another (`scope`), so the server sees the user's order.
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
 *     apply: (rows, { id, status }) => rows.map((r) => (r.id === id ? { ...r, status } : r)),
 *     revert: (rows, { id, status }, before) =>
 *       rows.map((r) => (r.id === id && r.status === status ? { ...r, status: before.find((b) => b.id === id)!.status } : r)),
 *   }),
 *   mutationFn: patchStatus,
 * })
 */
export function optimisticMutationOptions<TCache, TVariables>({
  queryKey,
  mutationKey,
  apply,
  revert,
}: OptimisticMutationConfig<TCache, TVariables>) {
  return {
    mutationKey,
    scope: { id: hashKey(mutationKey) },
    onMutate: async (
      variables: TVariables,
      { client }: MutationFunctionContext,
    ) => {
      await client.cancelQueries({ queryKey })
      const snapshot = client.getQueryData<TCache>(queryKey)
      client.setQueryData<TCache>(queryKey, (cache) => (cache === undefined ? cache : apply(cache, variables)))
      return { snapshot }
    },
    onError: (
      _error: unknown,
      variables: TVariables,
      context: OptimisticContext<TCache> | undefined,
      { client }: MutationFunctionContext,
    ) => {
      const snapshot = context?.snapshot
      if (snapshot === undefined) return
      client.setQueryData<TCache>(queryKey, (cache) =>
        cache === undefined ? cache : revert(cache, variables, snapshot),
      )
    },
    onSettled: (
      _data: unknown,
      _error: unknown,
      _variables: TVariables,
      _context: OptimisticContext<TCache> | undefined,
      { client }: MutationFunctionContext,
    ) => {
      // This mutation is still pending here; a newer one owns the cache until it settles too.
      if (client.isMutating({ mutationKey }) > 1) return
      // Not returned: awaiting the refetch would keep this mutation pending and hold up the next one in scope.
      void client.invalidateQueries({ queryKey })
    },
  }
}
