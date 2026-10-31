import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { consumeLocalSiteSwitch } from '@/api/local-site-switch'
import { siteKeys } from '@/api/sites'
import { stockTransferKeys } from '@/api/stock-transfers'
import { inventoryKeys } from '@/api/inventory'
import { API_BASE_URL } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { resetClientSession } from '@/auth/client-session-reset'
import { getQueryKeysToInvalidateForEntityType, getRealtimeInvalidationWindowMs, isEntityUpdatedPayload } from '@/features/realtime/dashboard-entity-map'
import { createEchoSafeInvalidator } from '@/features/realtime/echo-safe-invalidator'
import { createRealtimeResync } from '@/features/realtime/realtime-resync'
import { buildRealtimeSocketOptions, createHandshakeRetry } from '@/features/realtime/realtime-socket-options'
import {
  AUTH_CLAIMS_UPDATED_EVENT,
  ENTITY_UPDATED_EVENT,
  SITE_ACCESS_SCOPE_UPDATED_EVENT,
  SITE_CONTEXT_UPDATED_EVENT,
  STOCK_TRANSFER_UPDATED_EVENT,
  isClaimsUpdatedPayload,
  isSiteAccessScopeUpdatedPayload,
  isSiteContextUpdatedPayload,
  isStockTransferUpdatedPayload,
} from '@/features/realtime/types'
import { firebaseAuth } from '@/lib/firebase'
import { isE2EAuthBypassEnabled, isE2ETestTokenAuthEnabled } from '@/lib/runtime-flags'

type RealtimeConnection = {
  url: string
  path: string
  /** Set when `VITE_SOCKET_BASE_URL` points the socket straight at core-api. */
  direct?: true
}

type ResolveRealtimeConnectionOptions = {
  apiBaseUrl?: string
  socketBaseUrl?: string
  currentOrigin?: string
  isDev?: boolean
}

export function resolveRealtimeConnection({
  apiBaseUrl = API_BASE_URL,
  socketBaseUrl = import.meta.env.VITE_SOCKET_BASE_URL?.replace(/\/$/, ''),
  currentOrigin = typeof window !== 'undefined' ? window.location.origin : undefined,
  isDev = import.meta.env.DEV,
}: ResolveRealtimeConnectionOptions = {}): RealtimeConnection | undefined {
  const targetBaseUrl = socketBaseUrl || apiBaseUrl

  if (targetBaseUrl) {
    return {
      url: `${targetBaseUrl}/dashboard-realtime`,
      path: '/api/socket.io',
      ...(socketBaseUrl ? { direct: true as const } : {}),
    }
  }

  if (currentOrigin) {
    return {
      url: `${currentOrigin}/dashboard-realtime`,
      path: isDev ? '/socket.io' : '/api/socket.io',
    }
  }

  console.warn('Unable to resolve realtime base URL: neither socketBaseUrl, apiBaseUrl nor window.location.origin are available.')
  return undefined
}

type RealtimeDashboardSyncProviderProps = {
  children: React.ReactNode
}

export function RealtimeDashboardSyncProvider({ children }: RealtimeDashboardSyncProviderProps) {
  const queryClient = useQueryClient()
  const { signOutUser, user } = useAuth()
  const [token, setToken] = React.useState<string | null>(null)
  const shouldSkipRealtime =
    isE2EAuthBypassEnabled() || isE2ETestTokenAuthEnabled()

  // One filter per queryClient, not per socket: a token refresh must not flush echoes held for a pending drag.
  const echoSafeInvalidatorRef = React.useRef<ReturnType<typeof createEchoSafeInvalidator> | null>(null)
  React.useEffect(() => {
    const echoSafeInvalidator = createEchoSafeInvalidator(queryClient, { windowMs: getRealtimeInvalidationWindowMs })
    echoSafeInvalidatorRef.current = echoSafeInvalidator
    return () => {
      echoSafeInvalidatorRef.current = null
      echoSafeInvalidator.dispose()
    }
  }, [queryClient])

  React.useEffect(() => {
    if (shouldSkipRealtime) {
      setToken(null)
      return
    }

    let active = true

    if (!user) {
      setToken(null)
      return () => {
        active = false
      }
    }

    void user.getIdToken().then((idToken) => {
      if (active) {
        setToken(idToken)
      }
    }).catch(() => {
      if (active) {
        setToken(null)
      }
    })

    return () => {
      active = false
    }
  }, [shouldSkipRealtime, user])

  React.useEffect(() => {
    if (shouldSkipRealtime) return

    const connection = resolveRealtimeConnection()
    if (!connection || !token) return

    const socket: Socket = io(
      connection.url,
      buildRealtimeSocketOptions({
        path: connection.path,
        direct: connection.direct,
        getIdToken: async () => (await firebaseAuth?.currentUser?.getIdToken()) ?? null,
      }),
    )
    const handshakeRetry = createHandshakeRetry(socket)
    socket.on('connect', handshakeRetry.onConnect)
    socket.on('connect_error', handshakeRetry.onConnectError)
    socket.on('disconnect', handshakeRetry.onDisconnect)

    // Events emitted while the socket was away are gone: catch up on every reconnect and when the tab shows again.
    const resync = createRealtimeResync({
      invalidate: (queryKey) => echoSafeInvalidatorRef.current?.invalidate(queryKey),
      isConnected: () => socket.connected,
      reconnectSocket: handshakeRetry.reconnect,
    })
    socket.on('connect', resync.onConnect)
    resync.start()

    // Echoes of the user's own optimistic mutations must not refetch over the optimistic state.
    const onEntityUpdated = (payload: unknown) => {
      if (!isEntityUpdatedPayload(payload)) return

      for (const queryKey of getQueryKeysToInvalidateForEntityType(payload.type)) {
        echoSafeInvalidatorRef.current?.invalidate(queryKey)
      }
    }

    const onStockTransferUpdated = (payload: unknown) => {
      if (!isStockTransferUpdatedPayload(payload)) return

      void queryClient.invalidateQueries({
        queryKey: stockTransferKeys.all,
        refetchType: 'active',
      })
      void queryClient.invalidateQueries({
        queryKey: inventoryKeys.all,
        refetchType: 'active',
      })
    }

    // onClaimsUpdated and onSiteContextUpdated skip the echo filter: they switch the user's context, so all cached
    // data is stale at once. Both reset through the same cancel + clear + loading path as an in-tab switch.
    const onClaimsUpdated = (payload: unknown) => {
      if (!isClaimsUpdatedPayload(payload)) return

      void (async () => {
        const currentUser = firebaseAuth?.currentUser
        if (!currentUser) return

        try {
          // Refresh the token before any refetch so every request carries the new claims.
          const refreshedToken = await currentUser.getIdToken(true)
          setToken(refreshedToken)
          await resetClientSession(queryClient, 'context')
        } catch (error) {
          console.error('Failed to refresh claims after realtime auth update event.', error)
          await signOutUser()
        }
      })()
    }

    const onSiteContextUpdated = (payload: unknown) => {
      if (!isSiteContextUpdatedPayload(payload)) return
      // Only the tab that switched the site holds its data already; any other tab refetches, even when its session
      // already shows the new site (a null site included).
      if (consumeLocalSiteSwitch(payload.siteId)) return

      // Another tab switched the site: every cached query may belong to the site being left.
      void resetClientSession(queryClient, 'context')
    }

    const onSiteAccessScopeUpdated = (payload: unknown) => {
      if (!isSiteAccessScopeUpdatedPayload(payload)) return

      // A membership grant/revoke/deactivate (including a site that is not the
      // active site) drops cached site-directory and /me/sites results
      // (ruling 10).
      void queryClient.invalidateQueries({
        queryKey: siteKeys.all,
        refetchType: 'active',
      })
    }

    socket.on(ENTITY_UPDATED_EVENT, onEntityUpdated)
    socket.on(STOCK_TRANSFER_UPDATED_EVENT, onStockTransferUpdated)
    socket.on(AUTH_CLAIMS_UPDATED_EVENT, onClaimsUpdated)
    socket.on(SITE_CONTEXT_UPDATED_EVENT, onSiteContextUpdated)
    socket.on(SITE_ACCESS_SCOPE_UPDATED_EVENT, onSiteAccessScopeUpdated)

    return () => {
      socket.off(ENTITY_UPDATED_EVENT, onEntityUpdated)
      socket.off(STOCK_TRANSFER_UPDATED_EVENT, onStockTransferUpdated)
      socket.off(AUTH_CLAIMS_UPDATED_EVENT, onClaimsUpdated)
      socket.off(SITE_CONTEXT_UPDATED_EVENT, onSiteContextUpdated)
      socket.off(SITE_ACCESS_SCOPE_UPDATED_EVENT, onSiteAccessScopeUpdated)
      socket.off('connect', handshakeRetry.onConnect)
      socket.off('connect_error', handshakeRetry.onConnectError)
      socket.off('connect', resync.onConnect)
      resync.dispose()
      handshakeRetry.dispose()
      socket.disconnect()
    }
  }, [queryClient, shouldSkipRealtime, signOutUser, token])

  return <>{children}</>
}
