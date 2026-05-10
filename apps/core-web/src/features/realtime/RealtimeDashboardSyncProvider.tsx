import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { authSessionKeys } from '@/api/auth-session'
import { API_BASE_URL } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { getDashboardSourceKeysForEntityType, isEntityUpdatedPayload } from '@/features/realtime/dashboard-entity-map'
import {
  AUTH_CLAIMS_UPDATED_EVENT,
  ENTITY_UPDATED_EVENT,
  isClaimsUpdatedPayload,
} from '@/features/realtime/types'
import { firebaseAuth } from '@/lib/firebase'
import { isE2EAuthBypassEnabled } from '@/lib/runtime-flags'

type RealtimeConnection = {
  url: string
  path: string
}

type ResolveRealtimeConnectionOptions = {
  apiBaseUrl?: string
  currentOrigin?: string
  isDev?: boolean
}

export function resolveRealtimeConnection({
  apiBaseUrl = API_BASE_URL,
  currentOrigin = typeof window !== 'undefined' ? window.location.origin : undefined,
  isDev = import.meta.env.DEV,
}: ResolveRealtimeConnectionOptions = {}): RealtimeConnection | undefined {
  if (apiBaseUrl) {
    return {
      url: `${apiBaseUrl}/dashboard-realtime`,
      path: '/api/socket.io',
    }
  }

  if (currentOrigin) {
    return {
      url: `${currentOrigin}/dashboard-realtime`,
      path: isDev ? '/socket.io' : '/api/socket.io',
    }
  }

  console.warn('Unable to resolve realtime base URL: neither API_BASE_URL nor window.location.origin are available.')
  return undefined
}

type RealtimeDashboardSyncProviderProps = {
  children: React.ReactNode
}

export function RealtimeDashboardSyncProvider({ children }: RealtimeDashboardSyncProviderProps) {
  const queryClient = useQueryClient()
  const { signOutUser, user } = useAuth()
  const [token, setToken] = React.useState<string | null>(null)
  const shouldSkipRealtime = isE2EAuthBypassEnabled()

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

    const socket: Socket = io(connection.url, {
      path: connection.path,
      transports: ['websocket', 'polling'],
      withCredentials: true,
      auth: { token },
    })

    const onEntityUpdated = (payload: unknown) => {
      if (!isEntityUpdatedPayload(payload)) return

      const sourceKeys = getDashboardSourceKeysForEntityType(payload.type)
      for (const sourceKey of sourceKeys) {
        void queryClient.invalidateQueries({
          queryKey: ['dashboard-widget-data', sourceKey],
          refetchType: 'active',
        })
      }
    }

    const onClaimsUpdated = (payload: unknown) => {
      if (!isClaimsUpdatedPayload(payload)) return

      void (async () => {
        const currentUser = firebaseAuth?.currentUser
        if (!currentUser) return

        try {
          const refreshedToken = await currentUser.getIdToken(true)
          setToken(refreshedToken)
          queryClient.removeQueries({
            type: 'inactive',
            predicate: (query) => query.queryKey[0] !== authSessionKeys.all[0],
          })
          await queryClient.invalidateQueries({
            queryKey: authSessionKeys.all,
            refetchType: 'active',
          })
          await queryClient.invalidateQueries({ refetchType: 'active' })
        } catch (error) {
          console.error('Failed to refresh claims after realtime auth update event.', error)
          await signOutUser()
        }
      })()
    }

    socket.on(ENTITY_UPDATED_EVENT, onEntityUpdated)
    socket.on(AUTH_CLAIMS_UPDATED_EVENT, onClaimsUpdated)

    return () => {
      socket.off(ENTITY_UPDATED_EVENT, onEntityUpdated)
      socket.off(AUTH_CLAIMS_UPDATED_EVENT, onClaimsUpdated)
      socket.disconnect()
    }
  }, [queryClient, shouldSkipRealtime, signOutUser, token])

  return <>{children}</>
}
