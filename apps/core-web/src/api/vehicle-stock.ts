import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { useCursorList } from './cursor-list'
import { completeOffsetLatchHandoff } from './cursor-recovery'
import { buildDataTableUrl, resolveListSearch } from './data-table-query'
import type { components } from './generated/openapi'
import { vehicleKeys } from './vehicles'
import { isVehicleStockPatchOptimisticEligible } from '@/features/interaction/customer-vehicle-update-eligibility'
import { DETAIL_PREFETCH_GC_MS, DETAIL_PREFETCH_STALE_MS } from '@/lib/intent-prefetch'
import { optimisticMutationOptions } from '@/lib/optimistic-mutation'
import { patchRecordInCache, restoreRecordFields } from '@/lib/optimistic-record-patch'
import type { GewaehrleistungStatus } from '@/lib/vehicle-sale-warranty'

type VehicleStockCursorFilters = { search?: string; stock_status?: string }
type VehicleStockCursorParams = VehicleStockCursorFilters & { sortField?: string; sortDirection?: 'asc' | 'desc' }

/** Statuses of the filter select. ON_ORDER also lists the draft purchases, which only the offset list can merge in. */
export const VEHICLE_STOCK_STATUS_OPTIONS = ['IN_STOCK', 'RESERVED', 'IN_PREP', 'SOLD', 'ON_ORDER'] as const
const VEHICLE_STOCK_SEARCH_FILTER_FIELDS = ['vin', 'plate', 'make', 'model', 'color']
const VEHICLE_STOCK_CURSOR_SORT_FIELDS = new Set(['make', 'model', 'year', 'vin', 'plate', 'color', 'updatedAt'])

/**
 * Cursor paging needs a status that excludes the draft purchases and a whitelisted sort (ADR-0035, AUT-888);
 * "all statuses" and every other sort stay on offset paging.
 */
export function isVehicleStockCursorMode({ stockStatus, sortField }: { stockStatus?: string; sortField?: string }): boolean {
  const statusExcludesDrafts =
    VEHICLE_STOCK_STATUS_OPTIONS.some((status) => status === stockStatus) && stockStatus !== 'ON_ORDER'
  return statusExcludesDrafts && (!sortField || VEHICLE_STOCK_CURSOR_SORT_FIELDS.has(sortField))
}

export const vehicleStockKeys = {
  all: ['vehicle-stock'] as const,
  /** Offset and infinite list pages: what a field edit patches (a stock status change is never optimistic). */
  lists: () => [...vehicleStockKeys.all, 'list'] as const,
  list: (queryParams?: DataTableQueryParams) => [...vehicleStockKeys.lists(), queryParams] as const,
  cursorLists: () => [...vehicleStockKeys.all, 'cursor-list'] as const,
  cursorList: (params: VehicleStockCursorParams) => [...vehicleStockKeys.cursorLists(), params] as const,
  cappedCount: (filters: VehicleStockCursorFilters) =>
    [...vehicleStockKeys.all, 'capped-count', filters] as const,
  detail: (id: string) => [...vehicleStockKeys.all, 'detail', id] as const,
  purchases: () => [...vehicleStockKeys.all, 'purchases'] as const,
  purchase: (id: string) => [...vehicleStockKeys.purchases(), id] as const,
  sale: (id: string) => [...vehicleStockKeys.all, 'sales', id] as const,
  stockAgeReport: (filters: VehicleStockAgeReportFilters) =>
    [...vehicleStockKeys.all, 'reports', 'stock-age', filters] as const,
  marginReport: (filters: VehicleStockMarginReportFilters) =>
    [...vehicleStockKeys.all, 'reports', 'margin', filters] as const,
}

export const vehicleGewaehrleistungKeys = {
  all: ['vehicle-gewaehrleistung'] as const,
  due: (days: 30 | 60 | 90) => ['vehicle-gewaehrleistung', 'due', days] as const,
}

type GewaehrleistungDueResponse = components['schemas']['GewaehrleistungDueListResponseDto']
type GewaehrleistungDueRow = components['schemas']['GewaehrleistungDueListItemDto']
type CreateVehicleSaleDto = components['schemas']['CreateVehicleSaleDto']
type PatchVehicleSaleDto = components['schemas']['PatchVehicleSaleDto']
export type VehicleSaleTradeInInput = components['schemas']['UpsertVehicleSaleTradeInDto']

export function useGewaehrleistungDueList(days: 30 | 60 | 90) {
  return useQuery<GewaehrleistungDueResponse>({
    queryKey: vehicleGewaehrleistungKeys.due(days),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicle-stock/gewaehrleistung-due?endsWithinDays=${days}`)
      if (!response.ok) throw new Error('Gewährleistungsfälligkeiten konnten nicht geladen werden')
      return response.json() as Promise<GewaehrleistungDueResponse>
    },
  })
}

export type VehicleGewaehrleistungDueRow = GewaehrleistungDueRow

export type VehicleStockAgeReportRow = components['schemas']['VehicleStockAgeReportRowDto']
export type VehicleStockAgeBucket = Exclude<VehicleStockAgeReportRow['age_bucket'], null> | 'over_90'
export type VehicleStockAgeReportFilters = {
  inventory_role?: string
  stock_status?: string
  bucket?: VehicleStockAgeBucket
  page?: number
  limit?: number
}
export type VehicleStockMarginReportFilters = {
  from: string
  to: string
  page?: number
  limit?: number
}
export type VehicleStockMarginReportRow = components['schemas']['VehicleStockMarginReportRowDto']
export type VehicleStockAgeReportResponse = components['schemas']['VehicleStockAgeReportResponseDto']
export type VehicleStockMarginReportResponse = components['schemas']['VehicleStockMarginReportResponseDto']

type ApiErrorBody = {
  message?: string
  code?: string
}

async function parseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as ApiErrorBody
  throw Object.assign(new Error(payload.message || fallback), {
    status: response.status,
    data: payload,
  })
}

function reportQuery(filters: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return params.toString()
}

export function useVehicleStockAgeReport(filters: VehicleStockAgeReportFilters = {}) {
  return useQuery<VehicleStockAgeReportResponse>({
    queryKey: vehicleStockKeys.stockAgeReport(filters),
    queryFn: async () => {
      const query = reportQuery(filters)
      const response = await fetchWithAuth(`/api/vehicle-stock/reports/stock-age${query ? `?${query}` : ''}`)
      if (!response.ok) throw new Error('Failed to fetch stock age report')
      return response.json()
    },
  })
}

export function useVehicleStockMarginReport(filters: VehicleStockMarginReportFilters) {
  return useQuery<VehicleStockMarginReportResponse>({
    queryKey: vehicleStockKeys.marginReport(filters),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicle-stock/reports/margin?${reportQuery(filters)}`)
      if (!response.ok) throw new Error('Failed to fetch vehicle margin report')
      return response.json()
    },
    enabled: Boolean(filters.from && filters.to),
  })
}

export type VehicleStockRow = {
  id: string
  make: string
  model: string
  year: number
  vin: string | null
  plate: string | null
  color: string | null
  stock_status: string | null
  inventory_role: string
  mileage: number | null
  draft_purchase_id?: string | null
  location?: { id: string; name: string } | null
  reserved_for_customer?: {
    id: string
    first_name: string
    last_name: string
    company_name?: string | null
  } | null
}

export type VehicleStockListResponse = {
  data: VehicleStockRow[]
  meta: {
    total: number
    page: number
    pageSize: number
    pageCount: number
  }
}

export type VehicleLedgerEntry = {
  id: string
  entry_type: string
  amount: string | number
  posting_date: string
  notes: string | null
}

export type VehicleStockDetail = VehicleStockRow & {
  cost_basis: string | number
  key_number: string | null
  registration_certificate_no: string | null
  first_registration_date?: string | null
  co2_wltp_g_km?: number | null
  co2_nedc_g_km?: number | null
  typenschein_no?: string | null
  nova_class?: string | null
  emission_class?: string | null
  reserved_for_customer_id: string | null
  location_id: string | null
  ledger_entries: VehicleLedgerEntry[]
  purchases: Array<{ id: string; purchase_number: string; status: string }>
  sales: Array<{ id: string; sale_number: string; status: string }>
  workshop_orders: Array<{ id: string; order_number: string; status: string; purpose: string }>
}

export type VehiclePurchase = {
  id: string
  purchase_number: string
  status: string
  seller_type: 'VENDOR' | 'CUSTOMER'
  vendor_id: string | null
  customer_id: string | null
  vin: string
  make: string
  model: string
  year: number
  engine_code: string | null
  plate: string | null
  color: string | null
  mileage: number | null
  key_number: string | null
  registration_certificate_no: string | null
  purchase_price: string | number
  location_id: string | null
  vehicle_id: string | null
  customer?: {
    id: string
    type: 'PRIVATE' | 'COMPANY'
    first_name: string
    last_name: string
    company_name?: string | null
    email?: string | null
  } | null
}

type SaleWarrantyInputs = Partial<Pick<components['schemas']['CreateVehicleSaleDto'],
  'contract_concluded_at' | 'handed_over_at' | 'buyer_is_consumer' | 'gewaehrleistung_shortened_negotiated' | 'garantie_months' | 'garantie_terms'>>
type SaleWarrantyResponseFields = {
  contract_concluded_at?: string | null
  handed_over_at?: string | null
  buyer_is_consumer?: boolean | null
  gewaehrleistung_shortened_negotiated?: boolean | null
  gewaehrleistung_note?: string | null
  gewaehrleistung_ends_on?: string | null
  presumption_ends_on?: string | null
  /** Basisfrist badge status, computed by the API on the Europe/Vienna day; null without a snapshot. */
  gewaehrleistung_status?: GewaehrleistungStatus | null
  gewaehrleistung_ends_on_expired?: boolean
  presumption_ends_on_expired?: boolean
  garantie_months?: number | null
  garantie_terms?: string | null
  kaufvertrag_generated_at?: string | null
  kaufvertrag_generation_error?: string | null
}

/** Trade-in vehicle the buyer hands over on this sale; `purchase_price` is the allowance. */
export type VehicleSaleTradeInPurchase = {
  id: string
  purchase_number: string
  status: 'DRAFT' | 'RECEIVED' | 'CANCELLED'
  vin: string | null
  make: string
  model: string
  year: number
  mileage: number | null
  first_registration_date: string | null
  plate: string | null
  color: string | null
  purchase_price: string | number
}

export type VehicleSale = Omit<SaleWarrantyInputs, keyof SaleWarrantyResponseFields> & SaleWarrantyResponseFields & {
  id: string
  sale_number: string
  status: string
  vehicle_id: string
  customer_id: string
  sale_price: string | number
  cost_basis_preview?: string | number
  margin_vat_preview?: string | number
  amount_due_preview?: string | number
  trade_in_purchase?: VehicleSaleTradeInPurchase | null
  invoice?: { id: string; invoice_number: string | null; tax_mode: string }
  customer?: {
    id: string
    type: 'PRIVATE' | 'COMPANY'
    first_name: string
    last_name: string
    company_name?: string | null
    email?: string | null
  } | null
}

export type CreateVehiclePurchaseInput = {
  seller_type: 'VENDOR' | 'CUSTOMER'
  vendor_id?: string
  customer_id?: string
  vin: string
  make: string
  model: string
  year: number
  engine_code?: string
  plate?: string
  color?: string
  mileage?: number
  key_number?: string
  registration_certificate_no?: string
  purchase_price: number
  location_id?: string
}

export type PatchVehiclePurchaseInput = Partial<CreateVehiclePurchaseInput>

export type PatchVehicleStockInput = {
  location_id?: string | null
  reserved_for_customer_id?: string | null
  mileage?: number
  color?: string
  key_number?: string
  registration_certificate_no?: string
  first_registration_date?: string | null
  co2_wltp_g_km?: number | null
  co2_nedc_g_km?: number | null
  typenschein_no?: string | null
  nova_class?: string | null
  emission_class?: string | null
}

export function useVehicleStock(
  queryParams?: DataTableQueryParams,
  /** `fresh`: read even when cached (page 1 of an offset-latch handoff). */
  options?: { enabled?: boolean; offsetEpisodeKey?: string; fresh?: boolean },
) {
  const offsetEpisodeKey = options?.offsetEpisodeKey
  return useQuery<VehicleStockListResponse>({
    queryKey: vehicleStockKeys.list(queryParams),
    enabled: options?.enabled ?? true,
    ...(options?.fresh ? { staleTime: 0 } : {}),
    queryFn: async () => {
      const url = buildDataTableUrl('/api/vehicle-stock', queryParams, {
        searchFallbackFilterFields: VEHICLE_STOCK_SEARCH_FILTER_FIELDS,
        exactFilterMap: { stock_status: 'stock_status' },
      })
      const response = await fetchWithAuth(url)
      if (!response.ok) throw new Error('Failed to fetch vehicle stock')
      const payload = (await response.json()) as VehicleStockListResponse
      if (offsetEpisodeKey && queryParams?.page === 1) {
        completeOffsetLatchHandoff(offsetEpisodeKey)
      }
      return payload
    },
  })
}

function vehicleStockCursorEpisodeKey(params: Record<string, string | undefined>) {
  return JSON.stringify({
    search: params.search ?? '',
    stock_status: params.stock_status ?? '',
    sortField: params.sortField ?? '',
    sortDirection: params.sortDirection ?? '',
  })
}

/** Infinite dealer-stock list (cap 2,000 rows) with its capped count; idle while the offset list is in charge. */
export function useVehicleStockCursorList(queryParams: DataTableQueryParams, enabled: boolean) {
  const filters = {
    search: resolveListSearch(queryParams, VEHICLE_STOCK_SEARCH_FILTER_FIELDS),
    stock_status: queryParams.filters.find((filter) => filter.field === 'stock_status')?.value,
  }
  const params = { ...filters, sortField: queryParams.sortField, sortDirection: queryParams.sortDirection }
  return useCursorList<VehicleStockRow>({
    enabled,
    path: '/api/vehicle-stock',
    countPath: '/api/vehicle-stock/capped-count',
    semanticEpisodeKey: vehicleStockCursorEpisodeKey(params),
    listKey: vehicleStockKeys.cursorList(params),
    countKey: vehicleStockKeys.cappedCount(filters),
    params,
    countParams: filters,
  })
}

export const VEHICLE_STOCK_DETAIL_STALE_MS = DETAIL_PREFETCH_STALE_MS

export function vehicleStockDetailQueryOptions(vehicleId: string) {
  return {
    queryKey: vehicleStockKeys.detail(vehicleId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}`)
      if (!response.ok) throw new Error('Failed to fetch vehicle stock')
      return response.json() as Promise<VehicleStockDetail>
    },
    staleTime: VEHICLE_STOCK_DETAIL_STALE_MS,
    gcTime: DETAIL_PREFETCH_GC_MS,
  }
}

export function useVehicleStockDetail(vehicleId: string) {
  return useQuery<VehicleStockDetail>({
    ...vehicleStockDetailQueryOptions(vehicleId),
    enabled: !!vehicleId,
  })
}

type PatchVehicleStockVariables = { vehicleId: string; patch: PatchVehicleStockInput }

// Descriptive fields only (see the predicate); detail and every cached list page (offset or infinite) are patched.
const patchVehicleStockOptimistic = optimisticMutationOptions<unknown, PatchVehicleStockVariables>({
  queryKey: ({ vehicleId }) => vehicleStockKeys.detail(vehicleId),
  mutationKey: [...vehicleStockKeys.all, 'patch'],
  entityId: ({ vehicleId }) => vehicleId,
  shouldOptimistic: ({ patch }) => isVehicleStockPatchOptimisticEligible(patch),
  apply: (cache, { vehicleId, patch }) => patchRecordInCache(cache, vehicleId, patch),
  revert: (cache, { vehicleId, patch }, snapshot) => restoreRecordFields(cache, vehicleId, Object.keys(patch), snapshot),
  prefixCaches: [vehicleStockKeys.lists, vehicleStockKeys.cursorLists].map((queryKey) => ({
    queryKey,
    apply: (cache: unknown, { vehicleId, patch }: PatchVehicleStockVariables) =>
      patchRecordInCache(cache, vehicleId, patch),
    revert: (cache: unknown, { vehicleId, patch }: PatchVehicleStockVariables, snapshot: unknown) =>
      restoreRecordFields(cache, vehicleId, Object.keys(patch), snapshot),
  })),
})

export function usePatchVehicleStock(vehicleId: string) {
  const queryClient = useQueryClient()
  const { mutateAsync, ...mutation } = useMutation({
    ...patchVehicleStockOptimistic,
    mutationFn: async ({ patch }: PatchVehicleStockVariables) => {
      const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) await parseError(response, 'Failed to update vehicle stock')
      return response.json()
    },
    // Location and reservation (and the other server-confirmed fields) refetch every stock projection here.
    onSuccess: (_data, { patch }) => {
      if (!isVehicleStockPatchOptimisticEligible(patch)) {
        void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
      }
    },
  })
  return { ...mutation, mutateAsync: (patch: PatchVehicleStockInput) => mutateAsync({ vehicleId, patch }) }
}

export function vehiclePurchaseDetailQueryOptions(id: string) {
  return {
    queryKey: vehicleStockKeys.purchase(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicle-purchases/${id}`)
      if (!response.ok) throw new Error('Failed to fetch vehicle purchase')
      return response.json() as Promise<VehiclePurchase>
    },
    staleTime: VEHICLE_STOCK_DETAIL_STALE_MS,
    gcTime: DETAIL_PREFETCH_GC_MS,
  }
}

export function useVehiclePurchase(id: string) {
  return useQuery<VehiclePurchase>({
    ...vehiclePurchaseDetailQueryOptions(id),
    enabled: !!id && id !== 'new',
  })
}

export function useCreateVehiclePurchase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...vehicleStockKeys.all, 'purchase', 'create'],
    mutationFn: async (data: CreateVehiclePurchaseInput) => {
      const response = await fetchWithAuth('/api/vehicle-purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) await parseError(response, 'Failed to create vehicle purchase')
      return response.json() as Promise<VehiclePurchase>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
    },
  })
}

export function useUpdateVehiclePurchase(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...vehicleStockKeys.all, 'purchase', 'update'],
    mutationFn: async (data: PatchVehiclePurchaseInput) => {
      const response = await fetchWithAuth(`/api/vehicle-purchases/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) await parseError(response, 'Failed to update vehicle purchase')
      return response.json() as Promise<VehiclePurchase>
    },
    onSuccess: (purchase) => {
      queryClient.setQueryData(vehicleStockKeys.purchase(purchase.id), purchase)
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
    },
  })
}

export function useReceiveVehiclePurchase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...vehicleStockKeys.all, 'purchase', 'receive'],
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/vehicle-purchases/${id}/receive`, {
        method: 'POST',
      })
      if (!response.ok) await parseError(response, 'Failed to receive vehicle')
      return response.json() as Promise<VehiclePurchase>
    },
    onSuccess: (purchase) => {
      queryClient.setQueryData(vehicleStockKeys.purchase(purchase.id), purchase)
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
    },
  })
}

export function useDeleteVehiclePurchase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...vehicleStockKeys.all, 'purchase', 'delete'],
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/vehicle-purchases/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) await parseError(response, 'Failed to delete vehicle purchase')
      return id
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
    },
  })
}

export function useVehicleSale(id: string) {
  return useQuery<VehicleSale>({
    queryKey: vehicleStockKeys.sale(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicle-sales/${id}`)
      if (!response.ok) throw new Error('Failed to fetch vehicle sale')
      return response.json()
    },
    enabled: !!id && id !== 'new',
  })
}

export function useCreateVehicleSale() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...vehicleStockKeys.all, 'sale', 'create'],
    mutationFn: async (data: CreateVehicleSaleDto) => {
      const response = await fetchWithAuth('/api/vehicle-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) await parseError(response, 'Failed to create vehicle sale')
      return response.json() as Promise<VehicleSale>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.all })
      void queryClient.invalidateQueries({ queryKey: vehicleGewaehrleistungKeys.all })
    },
  })
}

export function useUpdateVehicleSale() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...vehicleStockKeys.all, 'sale', 'update'],
    mutationFn: async ({ id, data }: { id: string; data: PatchVehicleSaleDto }) => {
      const response = await fetchWithAuth(`/api/vehicle-sales/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) await parseError(response, 'Failed to update vehicle sale')
      return response.json() as Promise<VehicleSale>
    },
    onSuccess: (sale) => {
      queryClient.setQueryData(vehicleStockKeys.sale(sale.id), sale)
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.sale(sale.id) })
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.all })
      void queryClient.invalidateQueries({ queryKey: vehicleGewaehrleistungKeys.all })
    },
  })
}

export function useFinalizeVehicleSale() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...vehicleStockKeys.all, 'sale', 'finalize'],
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/vehicle-sales/${id}/finalize`, {
        method: 'POST',
      })
      if (!response.ok) await parseError(response, 'Failed to finalize vehicle sale')
      return response.json() as Promise<VehicleSale>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.all })
      void queryClient.invalidateQueries({ queryKey: vehicleGewaehrleistungKeys.all })
    },
  })
}

export function useUpsertVehicleSaleTradeIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...vehicleStockKeys.all, 'sale', 'trade-in', 'upsert'],
    mutationFn: async ({ id, data }: { id: string; data: VehicleSaleTradeInInput }) => {
      const response = await fetchWithAuth(`/api/vehicle-sales/${id}/trade-in`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) await parseError(response, 'Failed to save trade-in')
      return response.json() as Promise<VehicleSale>
    },
    onSuccess: (sale) => {
      queryClient.setQueryData(vehicleStockKeys.sale(sale.id), sale)
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.sale(sale.id) })
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
    },
  })
}

export function useRemoveVehicleSaleTradeIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...vehicleStockKeys.all, 'sale', 'trade-in', 'remove'],
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/vehicle-sales/${id}/trade-in`, {
        method: 'DELETE',
      })
      if (!response.ok) await parseError(response, 'Failed to remove trade-in')
      return response.json() as Promise<VehicleSale>
    },
    onSuccess: (sale) => {
      queryClient.setQueryData(vehicleStockKeys.sale(sale.id), sale)
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.sale(sale.id) })
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
    },
  })
}

/** Base path for vehicle sales. The Kaufvertrag PDF lives at `{base}/{id}/kaufvertrag/pdf`. */
export const VEHICLE_SALES_API = '/api/vehicle-sales'

/** Read while polling so a failed background generation stops the wait early. */
export async function fetchVehicleSaleKaufvertragGenerationError(saleId: string): Promise<string | null> {
  const response = await fetchWithAuth(`${VEHICLE_SALES_API}/${saleId}`)
  if (!response.ok) return null
  const sale = (await response.json()) as Pick<VehicleSale, 'kaufvertrag_generation_error'>
  return sale.kaufvertrag_generation_error ?? null
}
