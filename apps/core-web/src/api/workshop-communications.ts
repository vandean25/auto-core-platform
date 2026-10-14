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

const QUEUED_POLL_MS = 5_000
/** Only a recent QUEUED email is polled, so a row stuck in PENDING cannot keep an open page polling for days. */
const QUEUED_POLL_WINDOW_MS = 10 * 60 * 1000

/** Every five seconds while an email queued in the last ten minutes is still QUEUED; otherwise no polling. */
export function communicationRefetchInterval(
  entries: WorkshopOrderCommunication[] | undefined,
  now = Date.now(),
): number | false {
  const polling = entries?.some(
    (entry) => entry.status === 'QUEUED' && now - Date.parse(entry.occurred_at) < QUEUED_POLL_WINDOW_MS,
  )
  return polling ? QUEUED_POLL_MS : false
}

export function useWorkshopOrderCommunications(orderId: string) {
  return useQuery({
    queryKey: workshopCommunicationKeys.order(orderId),
    queryFn: () => fetchWorkshopOrderCommunications(orderId),
    enabled: Boolean(orderId),
    // Re-read on every mount and focus, so a customer decision shows without waiting for the global stale time.
    staleTime: 0,
    refetchInterval: (query) => communicationRefetchInterval(query.state.data),
  })
}
