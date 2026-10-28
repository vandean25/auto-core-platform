import { hashKey } from '@tanstack/react-query'
import type { QueryClient, QueryKey } from '@tanstack/react-query'

type EchoSafeInvalidatorOptions = {
  /**
   * Length in ms of the window in which a query key is refetched at most once. The first event of a burst refetches
   * at once, the rest of the burst collapses into one more refetch when the window ends. 0 means no coalescing.
   */
  windowMs?: (queryKey: QueryKey) => number
  now?: () => number
}

/**
 * Invalidates query keys for realtime events without letting the echo of a user's own change undo an
 * optimistic update: while a mutation whose key sits under the query key is pending, the invalidation is
 * deferred and runs once that mutation has settled. Echoes of other users' changes take the same path, so
 * they are delayed but never dropped.
 *
 * A burst of events (an import emits one per row) is coalesced per query key: at most one refetch per window,
 * and the last event of the burst is never lost, because the window ends with one more refetch.
 */
export function createEchoSafeInvalidator(queryClient: QueryClient, options: EchoSafeInvalidatorOptions = {}) {
  const { windowMs = () => 0, now = () => Date.now() } = options
  const deferred = new Map<string, QueryKey>()
  const lastRunAt = new Map<string, number>()
  const trailing = new Map<string, { queryKey: QueryKey; timer: ReturnType<typeof setTimeout> }>()

  const run = (queryKey: QueryKey) => {
    lastRunAt.set(hashKey(queryKey), now())
    void queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
  }
  const coalesced = (queryKey: QueryKey) => {
    const hash = hashKey(queryKey)
    if (trailing.has(hash)) return
    const wait = (lastRunAt.get(hash) ?? Number.NEGATIVE_INFINITY) + windowMs(queryKey) - now()
    if (wait <= 0) {
      run(queryKey)
      return
    }
    const timer = setTimeout(() => {
      trailing.delete(hash)
      run(queryKey)
    }, wait)
    trailing.set(hash, { queryKey, timer })
  }
  const isInFlight = (queryKey: QueryKey) => queryClient.isMutating({ mutationKey: queryKey }) > 0

  const unsubscribe = queryClient.getMutationCache().subscribe(() => {
    for (const [hash, queryKey] of deferred) {
      if (isInFlight(queryKey)) continue
      deferred.delete(hash)
      coalesced(queryKey)
    }
  })

  return {
    invalidate(queryKey: QueryKey) {
      if (isInFlight(queryKey)) deferred.set(hashKey(queryKey), queryKey)
      else coalesced(queryKey)
    },
    /** Stops listening; anything still deferred or waiting for its window is invalidated now so no update is lost (the settle refetch heals a mid-drag teardown). */
    dispose() {
      unsubscribe()
      const pending = [...deferred.values(), ...[...trailing.values()].map((entry) => entry.queryKey)]
      trailing.forEach((entry) => clearTimeout(entry.timer))
      trailing.clear()
      deferred.clear()
      pending.forEach(run)
    },
  }
}
