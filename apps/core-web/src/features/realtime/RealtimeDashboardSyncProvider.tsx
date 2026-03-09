import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { API_BASE_URL } from '@/api/client'
import { getDashboardSourceKeysForEntityType, isEntityUpdatedPayload } from '@/features/realtime/dashboard-entity-map'
import { ENTITY_UPDATED_EVENT } from '@/features/realtime/types'

function resolveRealtimeBaseUrl(): string {
  if (API_BASE_URL) return API_BASE_URL
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

type RealtimeDashboardSyncProviderProps = {
  children: React.ReactNode
}

export function RealtimeDashboardSyncProvider({ children }: RealtimeDashboardSyncProviderProps) {
  const queryClient = useQueryClient()

  React.useEffect(() => {
    const baseUrl = resolveRealtimeBaseUrl()
    const socket: Socket = io(`${baseUrl}/dashboard-realtime`, {
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
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
  }, [queryClient])

  return <>{children}</>
}
