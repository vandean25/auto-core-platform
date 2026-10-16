import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'

export type CommunicationPreferenceRow = {
  channel: string
  purpose: string
  effective_status: string | null
  allowed: boolean
  reason: string
}

export type CommunicationPreferencesResponse = {
  customer_id: string
  controller_legal_entity_id: string
  revision: number
  processing_status: string
  preferences: CommunicationPreferenceRow[]
}

export type CommunicationEventSummary = {
  id: string
  channel: string
  purpose: string
  status: string
  sequence: number
  recorded_at: string
  occurred_at: string
  source: string
  revoked_at: string | null
}

const consentKeys = {
  preferences: (customerId: string) => ['customer-consent', 'preferences', customerId] as const,
  history: (customerId: string) => ['customer-consent', 'history', customerId] as const,
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || response.statusText)
  }
  return response.json() as Promise<T>
}

export function useCustomerCommunicationPreferences(customerId: string) {
  return useQuery({
    queryKey: consentKeys.preferences(customerId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/customers/${customerId}/communication-preferences`,
      )
      return readJson<CommunicationPreferencesResponse>(response)
    },
    enabled: Boolean(customerId),
  })
}

export function useCustomerCommunicationHistory(customerId: string) {
  return useQuery({
    queryKey: consentKeys.history(customerId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/customers/${customerId}/communication-history`,
      )
      const payload = await readJson<{ data: CommunicationEventSummary[] }>(response)
      return payload.data
    },
    enabled: Boolean(customerId),
  })
}

export function useRecordCommunicationEvent(customerId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const response = await fetchWithAuth(
        `/api/customers/${customerId}/communication-events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      return readJson(response)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consentKeys.preferences(customerId) })
      queryClient.invalidateQueries({ queryKey: consentKeys.history(customerId) })
    },
  })
}
