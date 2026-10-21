import type { VehicleSale } from '@/api/vehicle-stock'
import type {
  Customer,
  InvoiceStatus,
  SalesOrderStatus,
  Vehicle,
  WorkshopOrderStatus,
} from '@/api/types'
import type { components } from '@/api/generated/openapi'

type VehicleSalesOrderSummary = {
  id: string
  order_number: string
  status: SalesOrderStatus
  total_amount: string | number
  createdAt: string
}

type VehicleWorkshopLine = {
  quantity?: string | number
  unit_price?: string | number
  qty?: string | number
  unitPrice?: string | number
}

type VehicleWorkshopTask = {
  line_items?: VehicleWorkshopLine[]
  lineItems?: VehicleWorkshopLine[]
}

export type VehicleWorkshopOrderSummary = {
  id: string
  order_number?: string
  status: WorkshopOrderStatus
  createdAt: string
  tasks?: VehicleWorkshopTask[]
}

export type VehicleInvoiceSummary = {
  id: string
  invoice_number: string | null
  status: InvoiceStatus
  date: string
  total_gross: string | number
}

export type VehicleDetailResponse = Vehicle & {
  customer?: Customer | null
  sales_orders?: VehicleSalesOrderSummary[]
  workshop_orders?: VehicleWorkshopOrderSummary[]
  invoices?: VehicleInvoiceSummary[]
  pickerl_due?: components['schemas']['PickerlDueDto']
  sales?: VehicleSale[]
}

export type ActiveOrderRow = {
  id: string
  type: 'Sales' | 'Service'
  number: string
  createdAt: string
  status: SalesOrderStatus | WorkshopOrderStatus
  total: number
}

export function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function getCustomerName(customer: Customer) {
  if (customer.type === 'COMPANY' && customer.company_name) {
    return customer.company_name
  }
  return `${customer.first_name} ${customer.last_name}`.trim()
}

export function getWorkshopOrderTotal(order: VehicleWorkshopOrderSummary) {
  return (order.tasks ?? []).reduce((taskSum, task) => {
    const lines = task.line_items ?? task.lineItems ?? []
    const total = lines.reduce(
      (sum, line) => sum + toNumber(line.quantity ?? line.qty) * toNumber(line.unit_price ?? line.unitPrice),
      0,
    )
    return taskSum + total
  }, 0)
}

export function getVehicleDescription(vehicle: VehicleDetailResponse) {
  const base = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
  return vehicle.plate ? `${base} (${vehicle.plate})` : base
}

/** First registration date as `YYYY-MM-DD` for date inputs and the NoVA preview. */
export function getFirstRegistrationDate(vehicle: VehicleDetailResponse) {
  return typeof vehicle.first_registration_date === 'string'
    ? vehicle.first_registration_date.slice(0, 10)
    : vehicle.first_registration_date ?? null
}

/** Sales and workshop orders that are not invoiced yet, newest first. */
export function getActiveOrders(vehicle: VehicleDetailResponse): ActiveOrderRow[] {
  const activeSalesOrders: ActiveOrderRow[] = (vehicle.sales_orders ?? [])
    .filter((order) => order.status !== 'INVOICED')
    .map((order) => ({
      id: order.id,
      type: 'Sales',
      number: order.order_number || `#${order.id.slice(0, 8)}`,
      createdAt: order.createdAt,
      status: order.status,
      total: toNumber(order.total_amount),
    }))

  const activeWorkshopOrders: ActiveOrderRow[] = (vehicle.workshop_orders ?? [])
    .filter((order) => order.status !== 'INVOICED')
    .map((order) => ({
      id: order.id,
      type: 'Service',
      number: order.order_number ?? `#${order.id.slice(0, 8)}`,
      createdAt: order.createdAt,
      status: order.status,
      total: getWorkshopOrderTotal(order),
    }))

  return [...activeSalesOrders, ...activeWorkshopOrders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}
