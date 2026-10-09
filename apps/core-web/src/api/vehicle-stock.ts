import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'
import type { components } from './generated/openapi'
import { vehicleKeys } from './vehicles'

export const vehicleStockKeys = {
  all: ['vehicle-stock'] as const,
  list: (queryParams?: DataTableQueryParams) =>
    [...vehicleStockKeys.all, 'list', queryParams] as const,
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
}

async function parseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as ApiErrorBody
  throw new Error(payload.message || fallback)
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
  'contract_concluded_at' | 'handed_over_at' | 'buyer_is_consumer' | 'gewaehrleistung_shortened_negotiated'>>
type SaleWarrantyResponseFields = {
  contract_concluded_at?: string | null
  handed_over_at?: string | null
  buyer_is_consumer?: boolean | null
  gewaehrleistung_shortened_negotiated?: boolean | null
  gewaehrleistung_note?: string | null
  gewaehrleistung_ends_on?: string | null
  presumption_ends_on?: string | null
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

export function useVehicleStock(queryParams?: DataTableQueryParams) {
  return useQuery<VehicleStockListResponse>({
    queryKey: vehicleStockKeys.list(queryParams),
    queryFn: async () => {
      const url = buildDataTableUrl('/api/vehicle-stock', queryParams, {
        searchFallbackFilterFields: ['vin', 'plate', 'make', 'model', 'color'],
      })
      const response = await fetchWithAuth(url)
      if (!response.ok) throw new Error('Failed to fetch vehicle stock')
      return response.json()
    },
  })
}

export function useVehicleStockDetail(vehicleId: string) {
  return useQuery<VehicleStockDetail>({
    queryKey: vehicleStockKeys.detail(vehicleId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}`)
      if (!response.ok) throw new Error('Failed to fetch vehicle stock')
      return response.json()
    },
    enabled: !!vehicleId,
  })
}

export function usePatchVehicleStock(vehicleId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: PatchVehicleStockInput) => {
      const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) await parseError(response, 'Failed to update vehicle stock')
      return response.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.all })
    },
  })
}

export function useVehiclePurchase(id: string) {
  return useQuery<VehiclePurchase>({
    queryKey: vehicleStockKeys.purchase(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicle-purchases/${id}`)
      if (!response.ok) throw new Error('Failed to fetch vehicle purchase')
      return response.json()
    },
    enabled: !!id && id !== 'new',
  })
}

export function useCreateVehiclePurchase() {
  const queryClient = useQueryClient()
  return useMutation({
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
