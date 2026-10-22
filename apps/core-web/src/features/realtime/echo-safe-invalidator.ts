import { hashKey } from '@tanstack/react-query'
import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Invalidates query keys for realtime events without letting the echo of a user's own change undo an
 * optimistic update: while a mutation whose key sits under the query key is pending, the invalidation is
 * deferred and runs once that mutation has settled. Echoes of other users' changes take the same path, so
 * they are delayed but never dropped.
 */
export function createEchoSafeInvalidator(queryClient: QueryClient) {
  const deferred = new Map<string, QueryKey>()
  const invalidate = (queryKey: QueryKey) =>
    void queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
  const isInFlight = (queryKey: QueryKey) => queryClient.isMutating({ mutationKey: queryKey }) > 0

  const unsubscribe = queryClient.getMutationCache().subscribe(() => {
    for (const [hash, queryKey] of deferred) {
      if (isInFlight(queryKey)) continue
      deferred.delete(hash)
      invalidate(queryKey)
    }
  })

  return {
    invalidate(queryKey: QueryKey) {
      if (isInFlight(queryKey)) deferred.set(hashKey(queryKey), queryKey)
      else invalidate(queryKey)
    },
    /** Stops listening; anything still deferred is invalidated now so no update is lost. */
    dispose() {
      unsubscribe()
      deferred.forEach(invalidate)
      deferred.clear()
    },
  }
}
