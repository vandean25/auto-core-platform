import { useQuery } from '@tanstack/react-query'
import { fetchWithAuth } from './client'

export const stockTransferKeys = {
  all: ['stock-transfers'] as const,
  list: (params: { page?: number; limit?: number; status?: string } = {}) =>
    [...stockTransferKeys.all, 'list', params] as const,
  detail: (transferId: string) =>
    [...stockTransferKeys.all, 'detail', transferId] as const,
} as const

export type StockTransfer = {
  id: string
  status: string
  from_site_id: string
  to_site_id: string
  from_site?: { name: string }
  to_site?: { name: string }
  lines: Array<Record<string, unknown>>
}

export function useStockTransfers(
  params: { page?: number; limit?: number; status?: string } = {},
) {
  return useQuery<StockTransfer[]>({
    queryKey: stockTransferKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) searchParams.set(key, String(value))
      }
      const response = await fetchWithAuth(`/api/stock-transfers?${searchParams}`)
      if (!response.ok) throw new Error('Failed to fetch stock transfers')
      return (await response.json()) as StockTransfer[]
    },
  })
}

export function useStockTransfer(transferId: string) {
  return useQuery<StockTransfer>({
    queryKey: stockTransferKeys.detail(transferId),
    enabled: Boolean(transferId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/stock-transfers/${transferId}`)
      if (!response.ok) throw new Error('Failed to fetch stock transfer')
      return (await response.json()) as StockTransfer
    },
  })
}
