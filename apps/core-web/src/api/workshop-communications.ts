import { useQuery } from '@tanstack/react-query'
import { fetchWithAuth } from '@/api/client'
import type { components } from '@/api/generated/openapi'

export type WorkshopOrderCommunication = components['schemas']['WorkshopOrderCommunicationDto']

/** The timeline of one order. Estimate sends and approvals refresh it through the estimate invalidation. */
export const workshopCommunicationKeys = {
  order: (orderId: string) => ['workshop', 'communications', orderId] as const,
}

/** Customer-facing communication of an order, newest first (ADR-0025 §8). Carries no address or typed name. */
export async function fetchWorkshopOrderCommunications(orderId: string): Promise<WorkshopOrderCommunication[]> {
  const response = await fetchWithAuth(`/api/workshop/orders/${orderId}/communications`)
  if (!response.ok) {
    throw Object.assign(new Error('Kommunikation konnte nicht geladen werden.'), { status: response.status })
  }
  const payload = (await response.json()) as components['schemas']['WorkshopOrderCommunicationsResponseDto']
  return payload.data
}

export function useWorkshopOrderCommunications(orderId: string) {
  return useQuery({
    queryKey: workshopCommunicationKeys.order(orderId),
    queryFn: () => fetchWorkshopOrderCommunications(orderId),
    enabled: Boolean(orderId),
  })
}
