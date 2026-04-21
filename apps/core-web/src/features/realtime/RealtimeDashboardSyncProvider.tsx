import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { API_BASE_URL } from '@/api/client'
import { getDashboardSourceKeysForEntityType, isEntityUpdatedPayload } from '@/features/realtime/dashboard-entity-map'
import { ENTITY_UPDATED_EVENT } from '@/features/realtime/types'
import { firebaseAuth } from '@/lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'

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
  const [token, setToken] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!firebaseAuth) return
    return onAuthStateChanged(firebaseAuth, async (user) => {
      if (user) {
        const idToken = await user.getIdToken()
        setToken(idToken)
      } else {
        setToken(null)
      }
    })
  }, [])

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

    socket.on(ENTITY_UPDATED_EVENT, onEntityUpdated)

    return () => {
      socket.off(ENTITY_UPDATED_EVENT, onEntityUpdated)
      socket.disconnect()
    }
  }, [queryClient, token])

  return <>{children}</>
}
