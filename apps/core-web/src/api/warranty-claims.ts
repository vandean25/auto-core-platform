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

/** A save that does not answer in this time fails, so the editor and its decision dialog never wait forever. */
export const WARRANTY_CLAIM_SAVE_TIMEOUT_MS = 30_000

/**
 * Runs a request that gives up after `ms`. The timer covers the whole call, including the token lookup that
 * runs before fetch and the body read, so a request that never settles cannot keep the editor busy.
 */
function withTimeout<T>(
  ms: number,
  timeoutMessage: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException(timeoutMessage, 'TimeoutError')
      controller.abort(error)
      reject(error)
    }, ms)
  })
  return Promise.race([run(controller.signal), timedOut]).finally(() => clearTimeout(timer))
}

export function updateWarrantyClaim(
  orderId: string,
  claimId: string,
  payload: UpdateWarrantyClaimPayload,
): Promise<WarrantyClaim> {
  return withTimeout(
    WARRANTY_CLAIM_SAVE_TIMEOUT_MS,
    'The save timed out. It may still have been saved, so reload the claim to check.',
    async (signal) => {
      const response = await fetchWithAuth(`${claimsUrl(orderId)}/${claimId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      if (!response.ok) throw await readErrorMessage(response, 'Failed to save warranty claim')
      return (await response.json()) as WarrantyClaim
    },
  )
}

/** The server renders the PDF within 15 seconds. The download gives up after this long, so Print cannot stay busy. */
export const WARRANTY_CLAIM_PDF_TIMEOUT_MS = 45_000

export function downloadWarrantyClaimPdf(orderId: string, claimId: string): Promise<Blob> {
  return withTimeout(
    WARRANTY_CLAIM_PDF_TIMEOUT_MS,
    'The PDF took too long to generate. Try again.',
    async (signal) => {
      const response = await fetchWithAuth(`${claimsUrl(orderId)}/${claimId}/pdf`, {
        headers: { Accept: 'application/pdf' },
        signal,
      })
      if (!response.ok) throw await readErrorMessage(response, 'Failed to generate the claim PDF')
      return response.blob()
    },
  )
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
    // A save that failed may still have been applied, and a timeout does not say whether it was. The
    // claim is read again instead of trusting the cache.
    onError: (_error, { orderId, claimId }) => {
      void queryClient.invalidateQueries({ queryKey: warrantyClaimKeys.detail(orderId, claimId) })
      void queryClient.invalidateQueries({ queryKey: warrantyClaimKeys.lists(orderId) })
    },
  })
}
