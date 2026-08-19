import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'
import type {
  CatalogSearchResponse,
  CreateWorkshopOrderPayload,
  LaborOperationSearchResponse,
  RegisterIntakePayload,
  WorkshopLineItemType,
  WorkshopOrder,
  WorkshopTask,
  WorkshopTaskLineItem,
  WorkshopPickPartsPayload,
  WorkshopPickPartsResponse,
  WorkshopSearchResponse,
  WorkshopTaskStatus,
} from './types'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'
import { laborKeys } from './labor'
import {
  getWorkshopCustomerDisplayName,
  isWorkshopOrderPickEligible,
} from '@/features/workshop/pick-utils'

const WORKSHOP_API = '/api/workshop'
const LABOR_API = '/api/labor'
const CATALOG_API = '/api/catalog'
const PICK_LIST_SOURCE_PAGE_SIZE = 100

type WorkshopApiError = Error & {
  status?: number
}

export const workshopKeys = {
  all: ['workshop'] as const,
  orders: () => [...workshopKeys.all, 'orders'] as const,
  ordersPage: (queryParams?: DataTableQueryParams) => [...workshopKeys.orders(), queryParams] as const,
  pickList: () => [...workshopKeys.all, 'pick-list'] as const,
  pickListPage: (queryParams?: DataTableQueryParams) => [...workshopKeys.pickList(), queryParams] as const,
  detail: (id: string) => [...workshopKeys.all, 'order', id] as const,
  order: (id: string) => workshopKeys.detail(id),
  search: (query: string) => [...workshopKeys.all, 'search', query] as const,
  boardResources: () => [...workshopKeys.all, 'board', 'resources'] as const,
  boardActive: () => [...workshopKeys.all, 'board', 'active'] as const,
}

export const catalogKeys = {
  all: ['catalog'] as const,
  search: (query: string, workshopOrderId: string) =>
    [...catalogKeys.all, 'search', query, workshopOrderId] as const,
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

type RawWorkshopTask = Omit<WorkshopTask, 'lineItems' | 'mechanicNotes'> & {
  lineItems?: WorkshopTaskLineItem[]
  line_items?: WorkshopTaskLineItem[]
  mechanicNotes?: string | null
  mechanic_notes?: string | null
}

type RawWorkshopOrder = Omit<WorkshopOrder, 'tasks'> & {
  tasks?: RawWorkshopTask[]
  orderNumber?: string
  reportedIssue?: string
  reported_issue?: string
  mechanicId?: string | null
  mechanic_id?: string | null
  bayId?: string | null
  bay_id?: string | null
  stagingLocationId?: string | null
  staging_location_id?: string | null
}

function normalizeTask(task: RawWorkshopTask): WorkshopTask {
  return {
    ...task,
    mechanicNotes: task.mechanicNotes ?? task.mechanic_notes ?? '',
    lineItems: task.lineItems ?? task.line_items ?? [],
  }
}

function normalizeOrder(order: RawWorkshopOrder): WorkshopOrder {
  return {
    ...order,
    order_number: order.order_number ?? order.orderNumber ?? order.id,
    reportedIssue: order.reportedIssue ?? order.reported_issue ?? '',
    mechanicId: order.mechanicId ?? order.mechanic_id ?? null,
    mechanic_id: order.mechanic_id ?? order.mechanicId ?? null,
    bayId: order.bayId ?? order.bay_id ?? null,
    bay_id: order.bay_id ?? order.bayId ?? null,
    stagingLocationId: order.stagingLocationId ?? order.staging_location_id ?? null,
    staging_location_id: order.staging_location_id ?? order.stagingLocationId ?? null,
    tasks: (order.tasks ?? []).map(normalizeTask),
  }
}

function countPickablePartLines(order: WorkshopOrder) {
  let count = 0
  for (const task of order.tasks ?? []) {
    for (const lineItem of task.lineItems ?? []) {
      if (lineItem.type === 'PART' && Number(lineItem.qty) > 0) {
        count += 1
      }
    }
  }
  return count
}

function totalPickablePartQuantity(order: WorkshopOrder) {
  let total = 0
  for (const task of order.tasks ?? []) {
    for (const lineItem of task.lineItems ?? []) {
      if (lineItem.type === 'PART' && Number(lineItem.qty) > 0) {
        total += Number(lineItem.qty)
      }
    }
  }
  return total
}

function comparePickListOrders(
  left: WorkshopOrder,
  right: WorkshopOrder,
  sortField?: string,
  sortDirection: 'asc' | 'desc' = 'desc',
) {
  const direction = sortDirection === 'asc' ? 1 : -1

  if (sortField === 'orderNo' || sortField === 'order_number') {
    return direction * (left.order_number ?? '').localeCompare(right.order_number ?? '')
  }

  if (sortField === 'customer') {
    return direction * getWorkshopCustomerDisplayName(left).localeCompare(getWorkshopCustomerDisplayName(right))
  }

  if (sortField === 'vehicle') {
    const leftVehicle = `${left.vehicle.year} ${left.vehicle.make} ${left.vehicle.model}`
    const rightVehicle = `${right.vehicle.year} ${right.vehicle.make} ${right.vehicle.model}`
    return direction * leftVehicle.localeCompare(rightVehicle)
  }

  if (sortField === 'status') {
    return direction * left.status.localeCompare(right.status)
  }

  if (sortField === 'partLines') {
    return direction * (countPickablePartLines(left) - countPickablePartLines(right))
  }

  if (sortField === 'requiredQty') {
    return direction * (totalPickablePartQuantity(left) - totalPickablePartQuantity(right))
  }

  const leftCreatedAt = Number(new Date(left.createdAt))
  const rightCreatedAt = Number(new Date(right.createdAt))
  return direction * (leftCreatedAt - rightCreatedAt)
}

async function parseErrorResponse(response: Response, fallbackMessage: string): Promise<WorkshopApiError> {
  const payload = await response.json().catch(() => ({})) as { message?: string }
  const error = new Error(payload.message || fallbackMessage) as WorkshopApiError
  error.status = response.status
  return error
}

async function fetchWorkshopOrdersPage(queryParams: DataTableQueryParams): Promise<WorkshopOrderResponse> {
  const url = buildDataTableUrl(`${WORKSHOP_API}/orders`, queryParams, {
    searchFallbackFilterFields: ['order_number', 'id', 'customer.first_name', 'customer.last_name', 'vehicle.make', 'vehicle.model', 'vehicle.plate'],
  })

  const response = await fetchWithAuth(url)
  if (!response.ok) throw new Error('Failed to fetch workshop pick list')

  const json = await response.json()
  return {
    ...json,
    data: (json.data ?? []).map(normalizeOrder),
  }
}

export function useWorkshopOrders(queryParams?: DataTableQueryParams) {
  return useQuery<WorkshopOrderResponse>({
    queryKey: workshopKeys.ordersPage(queryParams),
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

export function useWorkshopPickList(queryParams?: DataTableQueryParams) {
  return useQuery<WorkshopOrderResponse>({
    queryKey: workshopKeys.pickListPage(queryParams),
    queryFn: async () => {
      const sourceQueryParams: DataTableQueryParams = {
        page: 1,
        pageSize: PICK_LIST_SOURCE_PAGE_SIZE,
        search: queryParams?.search,
        sortField: queryParams?.sortField,
        sortDirection: queryParams?.sortDirection,
        filters: queryParams?.filters ?? [],
      }
      const firstPage = await fetchWorkshopOrdersPage(sourceQueryParams)
      const sourcePageCount = Math.max(1, firstPage.meta.pageCount)
      const additionalPages = sourcePageCount > 1
        ? await Promise.all(
          Array.from({ length: sourcePageCount - 1 }, (_, index) => fetchWorkshopOrdersPage({
            ...sourceQueryParams,
            page: index + 2,
          })),
        )
        : []

      const normalizedOrders = [firstPage, ...additionalPages].flatMap((page) => page.data)
      const filteredOrders = normalizedOrders.filter(isWorkshopOrderPickEligible)
      const sortedOrders = [...filteredOrders].sort((left, right) =>
        comparePickListOrders(left, right, queryParams?.sortField, queryParams?.sortDirection),
      )

      const page = queryParams?.page ?? 1
      const pageSize = queryParams?.pageSize ?? 25
      const offset = (page - 1) * pageSize
      const pagedOrders = sortedOrders.slice(offset, offset + pageSize)
      const pageCount = Math.max(1, Math.ceil(sortedOrders.length / pageSize))

      return {
        data: pagedOrders,
        meta: {
          total: sortedOrders.length,
          page,
          pageSize,
          pageCount,
        },
      }
    },
  })
}

export function useWorkshopOrder(id: string) {
  return useQuery<WorkshopOrder>({
    queryKey: workshopKeys.detail(id),
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
    queryKey: laborKeys.search(normalizedQuery, normalizedWorkshopOrderId),
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
    queryKey: catalogKeys.search(normalizedQuery, normalizedWorkshopOrderId),
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
      if (!response.ok) throw await parseErrorResponse(response, 'Failed to create workshop order')
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
        laborOperationId?: string | null
        standardAw?: number | null
        actualHours?: number | null
        internalCostRate?: number | null
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

export const usePickWorkshopParts = () => {
  const queryClient = useQueryClient()
  return useMutation<WorkshopPickPartsResponse, WorkshopApiError, { orderId: string; payload: WorkshopPickPartsPayload }>({
    mutationFn: async ({ orderId, payload }) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/pick-parts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw await parseErrorResponse(response, 'Failed to pick parts')
      }
      return response.json()
    },
    onSuccess: (_result, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.detail(orderId) })
      queryClient.invalidateQueries({ queryKey: workshopKeys.pickList() })
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
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

// ─── Board API ────────────────────────────────────────────────────────────────

export type WorkshopMechanic = components['schemas']['WorkshopMechanicDto']
export type WorkshopBay = components['schemas']['WorkshopBayDto']
export type WorkshopResourcesResponse = components['schemas']['WorkshopResourcesResponseDto']
export type BoardOrder = components['schemas']['BoardOrderDto']
export type BoardActiveResponse = components['schemas']['BoardActiveResponseDto']
export type AssignBoardPayload = components['schemas']['AssignBoardDto']

// Derived union type from the generated enum so consumers can reference it directly
export type PartsStatus = BoardOrder['partsStatus']

export type BoardAssignmentTarget = {
  kind: 'mechanic' | 'bay'
  id: string
  label: string
}

export const boardKeys = {
  all: ['workshop'] as const,
  resources: () => workshopKeys.boardResources(),
  active: () => workshopKeys.boardActive(),
}

export function useWorkshopResources() {
  return useQuery<WorkshopResourcesResponse>({
    queryKey: boardKeys.resources(),
    queryFn: async () => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/resources`)
      if (!response.ok) throw new Error('Failed to fetch workshop resources')
      return response.json()
    },
  })
}

export function useBoardActive() {
  return useQuery<BoardActiveResponse>({
    queryKey: boardKeys.active(),
    queryFn: async () => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/board/active`)
      if (!response.ok) throw new Error('Failed to fetch active board')
      return response.json()
    },
  })
}

export function useAssignBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: AssignBoardPayload) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/board/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string }
        throw new Error(body.message ?? 'Failed to assign board')
      }
      return response.json()
    },
    onSuccess: (_response, payload) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.active() })
      queryClient.invalidateQueries({ queryKey: workshopKeys.detail(payload.orderId) })
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
    },
  })
}

