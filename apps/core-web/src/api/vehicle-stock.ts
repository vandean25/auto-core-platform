import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'

export const vehicleStockKeys = {
  all: ['vehicle-stock'] as const,
  list: (queryParams?: DataTableQueryParams) =>
    [...vehicleStockKeys.all, 'list', queryParams] as const,
  detail: (id: string) => [...vehicleStockKeys.all, 'detail', id] as const,
  purchases: () => [...vehicleStockKeys.all, 'purchases'] as const,
  purchase: (id: string) => [...vehicleStockKeys.purchases(), id] as const,
  sale: (id: string) => [...vehicleStockKeys.all, 'sales', id] as const,
}

type ApiErrorBody = {
  message?: string
}

async function parseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as ApiErrorBody
  throw new Error(payload.message || fallback)
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

export type VehicleSale = {
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
    mutationFn: async (data: {
      vehicle_id: string
      customer_id: string
      sale_price: number
    }) => {
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
    },
  })
}

export function useUpdateVehicleSale(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: { customer_id?: string; sale_price?: number }) => {
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
    },
  })
}
