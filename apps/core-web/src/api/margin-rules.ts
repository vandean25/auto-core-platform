import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  CreateMarginRulePayload,
  MarginRule,
  PriceJumpThreshold,
  UpdateMarginRulePayload,
  UpdatePriceJumpThresholdPayload,
  VendorArticle,
} from './types'
import { fetchWithAuth } from './client'

export const marginRuleKeys = {
  all: ['margin-rules'] as const,
  list: () => [...marginRuleKeys.all, 'list'] as const,
  threshold: () => [...marginRuleKeys.all, 'threshold'] as const,
  vendorArticles: (vendorId: string) =>
    [...marginRuleKeys.all, 'vendor-articles', vendorId] as const,
}

async function readErrorMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string | string[] }
    | undefined
  if (Array.isArray(payload?.message)) {
    return payload.message.join(', ')
  }
  return payload?.message ?? fallback
}

export function useMarginRules() {
  return useQuery({
    queryKey: marginRuleKeys.list(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/margin-rules')
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to fetch margin rules'))
      }
      return response.json() as Promise<MarginRule[]>
    },
  })
}

export function usePriceJumpThreshold() {
  return useQuery({
    queryKey: marginRuleKeys.threshold(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/margin-rules/threshold')
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, 'Failed to fetch price jump threshold'),
        )
      }
      return response.json() as Promise<PriceJumpThreshold>
    },
  })
}

export function useCreateMarginRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateMarginRulePayload) => {
      const response = await fetchWithAuth('/api/margin-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to create margin rule'))
      }
      return response.json() as Promise<MarginRule>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marginRuleKeys.all })
    },
  })
}

export function useUpdateMarginRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string
      data: UpdateMarginRulePayload
    }) => {
      const response = await fetchWithAuth(`/api/margin-rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to update margin rule'))
      }
      return response.json() as Promise<MarginRule>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marginRuleKeys.all })
    },
  })
}

export function useDeleteMarginRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/margin-rules/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to delete margin rule'))
      }
      return response.json() as Promise<{ success: boolean }>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marginRuleKeys.all })
    },
  })
}

export function useUpdatePriceJumpThreshold() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UpdatePriceJumpThresholdPayload) => {
      const response = await fetchWithAuth('/api/margin-rules/threshold', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, 'Failed to update price jump threshold'),
        )
      }
      return response.json() as Promise<PriceJumpThreshold>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marginRuleKeys.threshold() })
    },
  })
}

export function useVendorArticles(vendorId: string | null | undefined) {
  return useQuery({
    queryKey: marginRuleKeys.vendorArticles(vendorId ?? ''),
    enabled: Boolean(vendorId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vendors/${vendorId}/articles`)
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load vendor articles'))
      }
      return response.json() as Promise<VendorArticle[]>
    },
  })
}
