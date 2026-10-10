import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type {
  CreateWarrantyClaimPayload,
  UpdateWarrantyClaimPayload,
  WarrantyClaim,
  WarrantyClaimListResponse,
  WarrantyClaimStatus,
} from './types'

const WORKSHOP_API = '/api/workshop'

export const warrantyClaimKeys = {
  all: ['warranty-claims'] as const,
  lists: (orderId: string) => [...warrantyClaimKeys.all, 'list', orderId] as const,
  list: (orderId: string, status?: WarrantyClaimStatus) =>
    [...warrantyClaimKeys.lists(orderId), status ?? 'all'] as const,
  detail: (orderId: string, claimId: string) =>
    [...warrantyClaimKeys.all, 'detail', orderId, claimId] as const,
}

const claimsUrl = (orderId: string) => `${WORKSHOP_API}/orders/${orderId}/warranty-claims`

async function readErrorMessage(response: Response, fallback: string): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as { message?: unknown } | null
  const message = Array.isArray(payload?.message)
    ? payload.message.join(' ')
    : typeof payload?.message === 'string'
      ? payload.message
      : fallback
  return new Error(message)
}

export async function fetchWarrantyClaims(
  orderId: string,
  status?: WarrantyClaimStatus,
): Promise<WarrantyClaimListResponse> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const response = await fetchWithAuth(`${claimsUrl(orderId)}${query}`)
  if (!response.ok) throw await readErrorMessage(response, 'Failed to load warranty claims')
  return response.json() as Promise<WarrantyClaimListResponse>
}

export async function fetchWarrantyClaim(orderId: string, claimId: string): Promise<WarrantyClaim> {
  const response = await fetchWithAuth(`${claimsUrl(orderId)}/${claimId}`)
  if (!response.ok) throw await readErrorMessage(response, 'Failed to load warranty claim')
  return response.json() as Promise<WarrantyClaim>
}

export async function createWarrantyClaim(
  orderId: string,
  payload: CreateWarrantyClaimPayload,
): Promise<WarrantyClaim> {
  const response = await fetchWithAuth(claimsUrl(orderId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw await readErrorMessage(response, 'Failed to create warranty claim')
  return response.json() as Promise<WarrantyClaim>
}

export async function updateWarrantyClaim(
  orderId: string,
  claimId: string,
  payload: UpdateWarrantyClaimPayload,
): Promise<WarrantyClaim> {
  const response = await fetchWithAuth(`${claimsUrl(orderId)}/${claimId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw await readErrorMessage(response, 'Failed to save warranty claim')
  return response.json() as Promise<WarrantyClaim>
}

export async function downloadWarrantyClaimPdf(orderId: string, claimId: string): Promise<Blob> {
  const response = await fetchWithAuth(`${claimsUrl(orderId)}/${claimId}/pdf`, {
    headers: { Accept: 'application/pdf' },
  })
  if (!response.ok) throw await readErrorMessage(response, 'Failed to generate the claim PDF')
  return response.blob()
}

export function useWarrantyClaims(orderId: string, status?: WarrantyClaimStatus) {
  return useQuery({
    queryKey: warrantyClaimKeys.list(orderId, status),
    queryFn: () => fetchWarrantyClaims(orderId, status),
    enabled: Boolean(orderId),
  })
}

export function useWarrantyClaim(orderId: string, claimId: string | null) {
  return useQuery({
    queryKey: warrantyClaimKeys.detail(orderId, claimId ?? ''),
    queryFn: () => fetchWarrantyClaim(orderId, claimId ?? ''),
    enabled: Boolean(orderId && claimId),
  })
}

export function useCreateWarrantyClaim() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, payload }: { orderId: string; payload: CreateWarrantyClaimPayload }) =>
      createWarrantyClaim(orderId, payload),
    onSuccess: (claim, { orderId }) => {
      queryClient.setQueryData(warrantyClaimKeys.detail(orderId, claim.id), claim)
      void queryClient.invalidateQueries({ queryKey: warrantyClaimKeys.lists(orderId) })
    },
  })
}

export function useUpdateWarrantyClaim() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      orderId,
      claimId,
      payload,
    }: {
      orderId: string
      claimId: string
      payload: UpdateWarrantyClaimPayload
    }) => updateWarrantyClaim(orderId, claimId, payload),
    onSuccess: (claim, { orderId, claimId }) => {
      queryClient.setQueryData(warrantyClaimKeys.detail(orderId, claimId), claim)
      void queryClient.invalidateQueries({ queryKey: warrantyClaimKeys.lists(orderId) })
    },
  })
}
