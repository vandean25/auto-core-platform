import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import type { components } from './generated/openapi'

const LABOR_API = '/api/labor'

async function getApiErrorMessage(res: Response, fallbackMessage: string) {
  const error = await res
    .json()
    .catch(() => ({ message: fallbackMessage })) as { message?: string }
  return error.message || fallbackMessage
}

export const laborKeys = {
  all: ['labor'] as const,
  categories: () => [...laborKeys.all, 'categories'] as const,
  operations: () => [...laborKeys.all, 'operations'] as const,
  operationsList: (queryParams?: DataTableQueryParams) => [...laborKeys.operations(), queryParams] as const,
  operation: (id: string) => [...laborKeys.all, 'operation', id] as const,
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type LaborCategory = components['schemas']['LaborCategoryResponseDto']
export type LaborCategoriesResponse = components['schemas']['LaborCategoriesResponseDto']

export type CreateLaborCategoryPayload = components['schemas']['CreateLaborCategoryDto']
export type UpdateLaborCategoryPayload = components['schemas']['UpdateLaborCategoryDto']

export type LaborOperation = components['schemas']['LaborOperationResponseDto']
export type PaginatedLaborOperationsResponse = components['schemas']['PaginatedLaborOperationsResponseDto']

export type CreateLaborOperationPayload = components['schemas']['CreateLaborOperationDto']
export type UpdateLaborOperationPayload = components['schemas']['UpdateLaborOperationDto']
export type SoftDeleteResponse = components['schemas']['SoftDeleteResponseDto']

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

export function useLaborOperations(queryParams?: DataTableQueryParams) {
  return useQuery<PaginatedLaborOperationsResponse>({
    queryKey: laborKeys.operationsList(queryParams),
    queryFn: async () => {
      if (!queryParams) {
        const res = await fetchWithAuth(`${LABOR_API}/operations`)
        if (!res.ok) throw new Error('Failed to fetch labor operations')
        return res.json()
      }

      // Build URL manually: backend uses `limit` (not `pageSize`) and ignores unknown params
      const params = new URLSearchParams()
      params.append('page', String(queryParams.page))
      params.append('limit', String(queryParams.pageSize))
      if (queryParams.search) params.append('search', queryParams.search)
      if (queryParams.sortField) params.append('sortField', queryParams.sortField)
      if (queryParams.sortDirection) params.append('sortDirection', queryParams.sortDirection)
      const categoryId = queryParams.filters.find((f) => f.field === 'categoryId')?.value
      if (categoryId) params.append('categoryId', categoryId)
      const isActive = queryParams.filters.find((f) => f.field === 'isActive')?.value
      if (isActive !== undefined && isActive !== '') params.append('isActive', isActive)

      const res = await fetchWithAuth(`${LABOR_API}/operations?${params.toString()}`)
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
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to create labor operation'))
      }
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
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to update labor operation'))
      }
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
