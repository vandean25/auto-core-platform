import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'
import type { components } from './generated/openapi'

const LABOR_API = '/api/labor'

export const laborKeys = {
  all: ['labor'] as const,
  categories: () => [...laborKeys.all, 'categories'] as const,
  operations: (queryParams?: DataTableQueryParams) => [...laborKeys.all, 'operations', queryParams] as const,
  operation: (id: string) => [...laborKeys.all, 'operation', id] as const,
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type LaborCategory = {
  id: string
  name: string
  description?: string | null
  sort_order?: number | null
  parent_id?: string | null
  default_hourly_rate?: number | null
  is_active?: boolean
  createdAt: string
  updatedAt: string
  children?: LaborCategory[]
}

export type LaborCategoriesResponse = {
  data: LaborCategory[]
  meta: {
    total: number
    topLevelCount: number
    childCount: number
  }
}

export type CreateLaborCategoryPayload = components['schemas']['CreateLaborCategoryDto']
export type UpdateLaborCategoryPayload = components['schemas']['UpdateLaborCategoryDto']

export type LaborOperation = components['schemas']['LaborOperationResponseDto']
export type PaginatedLaborOperationsResponse = components['schemas']['PaginatedLaborOperationsResponseDto']

export type CreateLaborOperationPayload = components['schemas']['CreateLaborOperationDto']
export type UpdateLaborOperationPayload = components['schemas']['UpdateLaborOperationDto']
export type SoftDeleteResponse = components['schemas']['SoftDeleteResponseDto']

// ── Categories ────────────────────────────────────────────────────────────────

export function useLaborCategories() {
  return useQuery<LaborCategoriesResponse>({
    queryKey: laborKeys.categories(),
    queryFn: async () => {
      const res = await fetchWithAuth(`${LABOR_API}/categories`)
      if (!res.ok) throw new Error('Failed to fetch labor categories')
      return res.json()
    },
  })
}

export function useCreateLaborCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: CreateLaborCategoryPayload) => {
      const res = await fetchWithAuth(`${LABOR_API}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to create labor category')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: laborKeys.categories() })
    },
  })
}

export function useUpdateLaborCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateLaborCategoryPayload }) => {
      const res = await fetchWithAuth(`${LABOR_API}/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update labor category')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: laborKeys.categories() })
    },
  })
}

export function useDeleteLaborCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`${LABOR_API}/categories/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to delete labor category' }))
        throw new Error(error.message || 'Failed to delete labor category')
      }
      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: laborKeys.categories() })
    },
  })
}

// ── Operations ────────────────────────────────────────────────────────────────

export function useLaborOperations(queryParams?: DataTableQueryParams) {
  return useQuery<PaginatedLaborOperationsResponse>({
    queryKey: laborKeys.operations(queryParams),
    queryFn: async () => {
      const url = buildDataTableUrl(`${LABOR_API}/operations`, queryParams, {
        searchFallbackFilterFields: ['code', 'description'],
      })
      const res = await fetchWithAuth(url)
      if (!res.ok) throw new Error('Failed to fetch labor operations')
      return res.json()
    },
  })
}

export function useLaborOperation(id: string) {
  return useQuery<LaborOperation>({
    queryKey: laborKeys.operation(id),
    queryFn: async () => {
      const res = await fetchWithAuth(`${LABOR_API}/operations/${id}`)
      if (!res.ok) throw new Error('Failed to fetch labor operation')
      return res.json()
    },
    enabled: !!id,
  })
}

export function useCreateLaborOperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: CreateLaborOperationPayload) => {
      const res = await fetchWithAuth(`${LABOR_API}/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to create labor operation')
      return res.json() as Promise<LaborOperation>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: laborKeys.operations() })
    },
  })
}

export function useUpdateLaborOperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateLaborOperationPayload }) => {
      const res = await fetchWithAuth(`${LABOR_API}/operations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update labor operation')
      return res.json() as Promise<LaborOperation>
    },
    onSuccess: (operation) => {
      queryClient.invalidateQueries({ queryKey: laborKeys.operations() })
      queryClient.invalidateQueries({ queryKey: laborKeys.operation(operation.id) })
    },
  })
}

export function useDeleteLaborOperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`${LABOR_API}/operations/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to delete labor operation' }))
        throw new Error(error.message || 'Failed to delete labor operation')
      }
      return res.json() as Promise<SoftDeleteResponse>
    },
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: laborKeys.operations() })
      queryClient.invalidateQueries({ queryKey: laborKeys.operation(id) })
    },
  })
}
