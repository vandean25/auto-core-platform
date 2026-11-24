import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import type { components } from './generated/openapi'

const LABOR_API = '/api/labor'

export const laborKeys = {
  all: ['labor'] as const,
  categories: () => [...laborKeys.all, 'categories'] as const,
  operations: () => [...laborKeys.all, 'operations'] as const,
  operationsList: (queryParams?: DataTableQueryParams) => [...laborKeys.operations(), queryParams] as const,
  operation: (id: string) => [...laborKeys.all, 'operation', id] as const,
  search: (query: string, workshopOrderId: string) =>
    [...laborKeys.all, 'search', query, workshopOrderId] as const,
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type LaborCategoriesResponse = components['schemas']['LaborCategoriesResponseDto']

export type CreateLaborCategoryPayload = components['schemas']['CreateLaborCategoryDto']
export type UpdateLaborCategoryPayload = components['schemas']['UpdateLaborCategoryDto']

export type LaborOperation = components['schemas']['LaborOperationResponseDto']

/**
 * Flattens hierarchical labor categories into a list for dropdowns.
 * Includes parent categories and their children with a separator.
 */
export function flattenLaborCategories(response?: LaborCategoriesResponse) {
  if (!response?.data) return []
  return response.data.flatMap((cat) => [
    { id: cat.id, name: cat.name },
    ...cat.children.map((child) => ({
      id: child.id,
      name: `${cat.name} › ${child.name}`,
    })),
  ])
}

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
