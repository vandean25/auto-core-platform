import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from '@/api/client'
import type { components } from '@/api/generated/openapi'

export type WorkshopEstimate = components['schemas']['WorkshopEstimateResponseDto']
export type WorkshopEstimateVersionSummary = components['schemas']['WorkshopEstimateVersionSummaryDto']
export type WorkshopEstimateVersionDetail = components['schemas']['WorkshopEstimateVersionDetailDto']
export type WorkshopEstimateOverrunWarning = components['schemas']['WorkshopEstimateOverrunWarningDto']
export type WorkshopEstimateStatus = WorkshopEstimateVersionSummary['status']

const WORKSHOP_API = '/api/workshop'

/** One factory for the estimate domain. Invalidating ['workshop', 'estimates'] refreshes every estimate query. */
export const workshopEstimateKeys = {
  all: ['workshop', 'estimates'] as const,
  order: (orderId: string) => [...workshopEstimateKeys.all, 'order', orderId] as const,
  version: (versionId: string) => [...workshopEstimateKeys.all, 'version', versionId] as const,
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: unknown }
    const message =
      typeof payload.message === 'string' && payload.message.trim() ? payload.message : fallbackMessage
    throw new Error(message)
  }
  return (await response.json()) as T
}

/** The estimate of a workshop order (one per order, created on demand), or null. */
export async function fetchWorkshopOrderEstimate(orderId: string): Promise<WorkshopEstimate | null> {
  const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/estimates`)
  const list = await readJson<{ data: WorkshopEstimate[] }>(response, 'Kostenvoranschlag konnte nicht geladen werden.')
  return list.data[0] ?? null
}

export async function fetchWorkshopEstimateVersion(versionId: string): Promise<WorkshopEstimateVersionDetail> {
  const response = await fetchWithAuth(`${WORKSHOP_API}/estimates/${versionId}`)
  return readJson<WorkshopEstimateVersionDetail>(response, 'Version konnte nicht geladen werden.')
}

export function workshopEstimatePdfPath(versionId: string): string {
  return `${WORKSHOP_API}/estimates/${versionId}/pdf`
}

/** Polling check for the async PDF: the safe error text of the last render, or null. */
export async function fetchWorkshopEstimatePdfError(versionId: string): Promise<string | null> {
  const response = await fetchWithAuth(`${WORKSHOP_API}/estimates/${versionId}`)
  if (!response.ok) {
    return null
  }
  const version = (await response.json()) as WorkshopEstimateVersionDetail
  return version.pdf_generation_error ?? null
}

export function workshopEstimatePdfFilename(estimateNumber: string, version: number): string {
  return `kostenvoranschlag-${estimateNumber}-v${version}`.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.pdf'
}

export function useWorkshopOrderEstimate(orderId: string) {
  return useQuery({
    queryKey: workshopEstimateKeys.order(orderId),
    queryFn: () => fetchWorkshopOrderEstimate(orderId),
    enabled: Boolean(orderId),
  })
}

/** Full version detail. Used for the live totals of a DRAFT, which the list does not carry. */
export function useWorkshopEstimateVersion(versionId: string | null) {
  return useQuery({
    queryKey: workshopEstimateKeys.version(versionId ?? ''),
    queryFn: () => fetchWorkshopEstimateVersion(versionId as string),
    enabled: Boolean(versionId),
  })
}

function invalidateEstimate(queryClient: ReturnType<typeof useQueryClient>, orderId: string) {
  return queryClient.invalidateQueries({ queryKey: workshopEstimateKeys.order(orderId) })
}

export function useCreateWorkshopEstimate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/estimates`, { method: 'POST' })
      return readJson<WorkshopEstimate>(response, 'Kostenvoranschlag konnte nicht erstellt werden.')
    },
    onSuccess: (_estimate, orderId) => invalidateEstimate(queryClient, orderId),
  })
}

/** A revision is a new DRAFT version under the same number. The sent versions stay readable. */
export function useReviseWorkshopEstimate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/estimates/revisions`, {
        method: 'POST',
      })
      return readJson<WorkshopEstimateVersionDetail>(response, 'Neue Version konnte nicht erstellt werden.')
    },
    onSuccess: (_version, orderId) => invalidateEstimate(queryClient, orderId),
  })
}

export function useSendWorkshopEstimateVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ versionId }: { orderId: string; versionId: string }) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/estimates/${versionId}/send`, { method: 'POST' })
      return readJson<WorkshopEstimateVersionDetail>(response, 'Kostenvoranschlag konnte nicht gesendet werden.')
    },
    onSuccess: (_version, { orderId, versionId }) => {
      void queryClient.invalidateQueries({ queryKey: workshopEstimateKeys.version(versionId) })
      return invalidateEstimate(queryClient, orderId)
    },
  })
}
