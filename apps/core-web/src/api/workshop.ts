import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type {
  CatalogSearchResponse,
  CreateWorkshopOrderPayload,
  LaborOperationSearchResponse,
  RegisterIntakePayload,
  WorkshopLineItemType,
  WorkshopOrder,
  WorkshopSearchResponse,
  WorkshopTaskStatus,
} from './types'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'

const WORKSHOP_API = '/api/workshop'
const LABOR_API = '/api/labor'
const CATALOG_API = '/api/catalog'

export const workshopKeys = {
  all: ['workshop'] as const,
  orders: () => [...workshopKeys.all, 'orders'] as const,
  order: (id: string) => [...workshopKeys.all, 'order', id] as const,
  search: (query: string) => [...workshopKeys.all, 'search', query] as const,
}

type WorkshopOrderResponse = {
  data: WorkshopOrder[]
  meta: {
    total: number
    page: number
    pageSize: number
    pageCount: number
  }
}

function normalizeTask(task: any) {
  return {
    ...task,
    mechanicNotes: task.mechanicNotes ?? task.mechanic_notes ?? '',
    lineItems: task.lineItems ?? task.line_items ?? [],
  }
}

function normalizeOrder(order: any): WorkshopOrder {
  return {
    ...order,
    order_number: order.order_number ?? order.orderNumber ?? order.id,
    reportedIssue: order.reportedIssue ?? order.reported_issue ?? '',
    tasks: (order.tasks ?? []).map(normalizeTask),
  }
}

export function useWorkshopOrders(queryParams?: DataTableQueryParams) {
  return useQuery<WorkshopOrderResponse>({
    queryKey: [...workshopKeys.orders(), queryParams],
    queryFn: async () => {
      const url = buildDataTableUrl(`${WORKSHOP_API}/orders`, queryParams, {
        searchFallbackFilterFields: ['order_number', 'id', 'customer.first_name', 'customer.last_name', 'vehicle.make', 'vehicle.model', 'vehicle.plate'],
      })
      const response = await fetchWithAuth(url)
      if (!response.ok) throw new Error('Failed to fetch workshop orders')
      const json = await response.json()
      return {
        ...json,
        data: (json.data ?? []).map(normalizeOrder),
      }
    },
  })
}

export function useWorkshopOrder(id: string) {
  return useQuery<WorkshopOrder>({
    queryKey: workshopKeys.order(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${id}`)
      if (!response.ok) throw new Error('Failed to fetch workshop order')
      const json = await response.json()
      return normalizeOrder(json)
    },
    enabled: !!id,
  })
}

export const useWorkshopSearch = (query: string) => {
  return useQuery<WorkshopSearchResponse>({
    queryKey: workshopKeys.search(query),
    queryFn: async () => {
      if (!query || query.length < 2) return { data: { vehicles: [], customers: [] }, meta: { total: 0, page: 1, limit: 0, totalPages: 0 } }
      const response = await fetchWithAuth(`${WORKSHOP_API}/search?q=${encodeURIComponent(query)}`)
      if (!response.ok) throw new Error('Failed to search')
      return response.json()
    },
    enabled: query.length >= 2,
  })
}

export const useLaborSearch = (
  query: string,
  workshopOrderId: string,
  enabled = true,
) => {
  const normalizedQuery = query.trim().toLowerCase()
  const normalizedWorkshopOrderId = workshopOrderId.trim()
  return useQuery<LaborOperationSearchResponse>({
    queryKey: ['labor', 'search', normalizedQuery, normalizedWorkshopOrderId],
    queryFn: async () => {
      if (!normalizedQuery || !normalizedWorkshopOrderId) {
        return { data: [], meta: { total: 0, limit: 20 } }
      }
      const response = await fetchWithAuth(
        `${LABOR_API}/search?q=${encodeURIComponent(normalizedQuery)}&workshopOrderId=${encodeURIComponent(normalizedWorkshopOrderId)}`,
      )
      if (!response.ok) throw new Error('Failed to search labor operations')
      return response.json()
    },
    enabled: enabled && normalizedQuery.length >= 2 && !!normalizedWorkshopOrderId,
  })
}

export const useCatalogSearch = (
  query: string,
  workshopOrderId: string,
  enabled = true,
) => {
  const normalizedQuery = query.trim().toLowerCase()
  const normalizedWorkshopOrderId = workshopOrderId.trim()
  return useQuery<CatalogSearchResponse>({
    queryKey: ['catalog', 'search', normalizedQuery, normalizedWorkshopOrderId],
    queryFn: async () => {
      if (!normalizedQuery || !normalizedWorkshopOrderId) {
        return { labor: [], parts: [], meta: { laborCount: 0, partCount: 0, limit: 20 } }
      }
      const response = await fetchWithAuth(
        `${CATALOG_API}/search?q=${encodeURIComponent(normalizedQuery)}&workshopOrderId=${encodeURIComponent(normalizedWorkshopOrderId)}`,
      )
      if (!response.ok) throw new Error('Failed to search catalog')
      return response.json()
    },
    enabled: enabled && normalizedQuery.length >= 2 && !!normalizedWorkshopOrderId,
  })
}

export const useCreateWorkshopOrder = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateWorkshopOrderPayload) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('Failed to create workshop order')
      const json = await response.json()
      return normalizeOrder(json)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
    },
  })
}

export const useUpdateWorkshopOrder = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      notes,
      reportedIssue,
    }: {
      id: string
      notes?: string
      reportedIssue?: string
    }) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, reportedIssue }),
      })
      if (!response.ok) throw new Error('Failed to update workshop order')
      const json = await response.json()
      return normalizeOrder(json)
    },
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
      queryClient.setQueryData(workshopKeys.order(order.id), order)
    },
  })
}

export const useCreateWorkshopTask = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderId, title }: { orderId: string; title: string }) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!response.ok) throw new Error('Failed to create task')
      return response.json()
    },
    onSuccess: (_task, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.order(orderId) })
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
    },
  })
}

export const useUpdateWorkshopTask = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      orderId,
      taskId,
      title,
      status,
      mechanicNotes,
    }: {
      orderId: string
      taskId: string
      title?: string
      status?: WorkshopTaskStatus
      mechanicNotes?: string
    }) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, status, mechanicNotes }),
      })
      if (!response.ok) throw new Error('Failed to update task')
      const json = await response.json()
      return normalizeOrder(json)
    },
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
      queryClient.setQueryData(workshopKeys.order(order.id), order)
    },
  })
}

export const useDeleteWorkshopTask = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderId, taskId }: { orderId: string; taskId: string }) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/tasks/${taskId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to delete task' }))
        throw new Error(error.message || 'Failed to delete task')
      }
      const json = await response.json()
      return normalizeOrder(json)
    },
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
      queryClient.setQueryData(workshopKeys.order(order.id), order)
    },
    onSettled: (_order, _error, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.order(orderId) })
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
    },
  })
}

export const useReplaceWorkshopTaskLineItems = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      orderId,
      taskId,
      items,
    }: {
      orderId: string
      taskId: string
      items: Array<{
        type: WorkshopLineItemType
        itemNo: string
        description: string
        qty: number
        unitPrice: number
      }>
    }) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/tasks/${taskId}/line-items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (!response.ok) throw new Error('Failed to update task line items')
      const json = await response.json()
      return normalizeOrder(json)
    },
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
      queryClient.setQueryData(workshopKeys.order(order.id), order)
    },
  })
}

export const useCreateInvoiceFromWorkshopOrder = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/create-invoice`, {
        method: 'POST',
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to create invoice from workshop order' }))
        throw new Error(error.message || 'Failed to create invoice from workshop order')
      }
      return response.json()
    },
    onSuccess: (_invoice, orderId) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
      queryClient.invalidateQueries({ queryKey: workshopKeys.order(orderId) })
    },
  })
}

export const useRegisterIntake = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: RegisterIntakePayload) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('Failed to register intake')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.all })
    },
  })
}

export function useGenerateWorkshopPdf() {
  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetchWithAuth(
        `${WORKSHOP_API}/orders/${orderId}/pdf`,
        { method: 'POST' },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({
          message: 'Failed to generate PDF',
        }))
        throw new Error(payload.message || 'Failed to generate PDF')
      }
      return response.json() as Promise<{
        message?: string
        enqueued?: boolean
        success?: boolean
        cached?: boolean
      }>
    },
  })
}

export async function downloadWorkshopPdf(orderId: string): Promise<Blob> {
  const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/pdf`, {
    headers: {
      Accept: 'application/pdf',
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'Failed to download workshop PDF')
  }
  return response.blob()
}
