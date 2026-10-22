import { hashKey } from '@tanstack/react-query'
import type { Mutation, MutationFunctionContext, QueryKey } from '@tanstack/react-query'

type OptimisticMutationConfig<TCache, TVariables> = {
  /** Query whose cached data the mutation patches optimistically. */
  queryKey: QueryKey
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
}

type OptimisticContext<TCache> = { snapshot: TCache | undefined }

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
 *       return prev ? rows.map((r) => (r.id === id && r.status === status ? { ...r, status: prev.status } : r)) : rows
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
      // Scope runs mutations in order, so any other pending one of this entity is newer; this one is still counted.
      const sameEntity = (mutation: Mutation) => entityId(mutation.state.variables as TVariables) === entityId(variables)
      if (client.isMutating({ mutationKey, exact: true, predicate: sameEntity }) > 1) return
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
      // This mutation is still pending here; a newer one (of any mutation under `queryKey`) owns the cache until it settles too.
      if (client.isMutating({ mutationKey: queryKey }) > 1) return
      // Not returned: awaiting the refetch would keep this mutation pending and hold up the next one in scope.
      void client.invalidateQueries({ queryKey })
    },
  }
}
