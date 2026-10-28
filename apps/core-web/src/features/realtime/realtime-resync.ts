import type { QueryKey } from '@tanstack/react-query'
import { getRealtimeResyncQueryKeys } from '@/features/realtime/dashboard-entity-map'

/** A reconnect and a tab that becomes visible in the same moment catch up once, not twice. */
export const REALTIME_RESYNC_MIN_INTERVAL_MS = 10_000

type RealtimeResyncOptions = {
  invalidate: (queryKey: QueryKey) => void
  /** Brings a socket back that dropped while the tab was hidden. */
  reconnectSocket: () => void
  now?: () => number
  visibilitySource?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
}

/**
 * Catches up on realtime events a socket missed while it was away (idle tab, scale-to-zero, deploy, the 300 s Cloud
 * Run request timeout). It invalidates the realtime-backed queries by their targeted keys, active ones refetch, and it
 * never touches the rest of the cache. The first connect does not resync: nothing can have been missed yet.
 */
export function createRealtimeResync({
  invalidate,
  reconnectSocket,
  now = () => Date.now(),
  visibilitySource = document,
}: RealtimeResyncOptions) {
  let hasConnected = false
  let lastResyncAt = Number.NEGATIVE_INFINITY

  const resync = () => {
    const current = now()
    if (current - lastResyncAt < REALTIME_RESYNC_MIN_INTERVAL_MS) return
    lastResyncAt = current
    getRealtimeResyncQueryKeys().forEach(invalidate)
  }

  const onVisibilityChange = () => {
    if (visibilitySource.visibilityState !== 'visible') return
    reconnectSocket()
    resync()
  }

  return {
    onConnect() {
      if (hasConnected) resync()
      hasConnected = true
    },
    start() {
      visibilitySource.addEventListener('visibilitychange', onVisibilityChange)
    },
    dispose() {
      visibilitySource.removeEventListener('visibilitychange', onVisibilityChange)
    },
  }
}
