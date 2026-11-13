import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/auth/AuthProvider'

import { handshakeScopeContext, invalidateProtectedScopeContext } from '@/auth/scope-context-client'
import { SCOPE_CONTEXT_SESSION_LINEAGE_STORAGE_KEY } from '@/auth/scope-context.constants'
import { REALTIME_RESYNC_MIN_INTERVAL_MS } from '@/features/realtime/resync-interval'

type ScopeContextProviderProps = {
  children: React.ReactNode
  /** When false, handshake is skipped (public approval routes). */
  enabled: boolean
}

/**
 * ADR-0038 §6: a lifecycle handshake on resume, focus, reconnect and online quarantines protected list caches until it succeeds.
 */
export function ScopeContextProvider({ children, enabled }: ScopeContextProviderProps) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return undefined

    let lastHandshakeAt = Number.NEGATIVE_INFINITY

    const markInfiniteListsStaleForRefresh = () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Boolean(query.meta && (query.meta as { listPagination?: string }).listPagination === 'infinite'),
        refetchType: 'none',
      })
    }

    const handshakeNow = () => {
      lastHandshakeAt = Date.now()
      invalidateProtectedScopeContext()
      // Generation-only bumps fence in-flight responses; quarantine waits for handshake below.
      // Forced: a flight that started before this invalidation would keep the lists quarantined on a `same` result.
      void handshakeScopeContext({ force: true }).then((result) => {
        if (result.kind === 'external-scope' || result.kind === 'failed') {
          markInfiniteListsStaleForRefresh()
        }
      })
    }

    const runHandshake = () => {
      if (Date.now() - lastHandshakeAt < REALTIME_RESYNC_MIN_INTERVAL_MS) return
      handshakeNow()
    }

    // A phone resume often fires neither focus nor a persisted pageshow.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runHandshake()
    }

    // The mount handshake counts toward the throttle, so the first focus does not quarantine lists that just loaded.
    lastHandshakeAt = Date.now()
    void handshakeScopeContext().then((result) => {
      if (result.kind === 'external-scope' || result.kind === 'failed') {
        markInfiniteListsStaleForRefresh()
      }
    })

    window.addEventListener('focus', runHandshake)
    window.addEventListener('online', runHandshake)

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) runHandshake()
    }
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibilityChange)

    const onStorage = (event: StorageEvent) => {
      if (event.key !== SCOPE_CONTEXT_SESSION_LINEAGE_STORAGE_KEY) return
      // A sign-in or sign-out in another tab always runs, even within the focus throttle.
      handshakeNow()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener('focus', runHandshake)
      window.removeEventListener('online', runHandshake)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [enabled, queryClient])

  return children
}

export function ScopeContextGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  return <ScopeContextProvider enabled={Boolean(user) && !loading}>{children}</ScopeContextProvider>
}
