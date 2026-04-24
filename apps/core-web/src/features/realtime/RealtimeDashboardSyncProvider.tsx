import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { API_BASE_URL } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { getDashboardSourceKeysForEntityType, isEntityUpdatedPayload } from '@/features/realtime/dashboard-entity-map'
import {
  AUTH_CLAIMS_UPDATED_EVENT,
  ENTITY_UPDATED_EVENT,
  isClaimsUpdatedPayload,
} from '@/features/realtime/types'
import { firebaseAuth } from '@/lib/firebase'

function resolveRealtimeBaseUrl(): string | undefined {
  if (API_BASE_URL) return API_BASE_URL
  if (typeof window !== 'undefined' && window.location.origin) return window.location.origin
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

  React.useEffect(() => {
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
  }, [user])

  React.useEffect(() => {
    const baseUrl = resolveRealtimeBaseUrl()
    if (!baseUrl || !token) return

    const socket: Socket = io(`${baseUrl}/dashboard-realtime`, {
      path: '/api/socket.io',
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
  }, [queryClient, signOutUser, token])

  return <>{children}</>
}
