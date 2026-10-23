import type { components } from '@/api/generated/openapi'
import type {
  Customer,
  InvoiceStatus,
  NormalizedWorkshopTaskLineItem,
  SalesOrderStatus,
  Vehicle,
  WorkshopOrderStatus,
} from '@/api/types'

type SalesOrderSummary = {
  id: string
  order_number: string
  status: SalesOrderStatus
  total_amount: string | number
  createdAt: string
}

type WorkshopLineItemSummary = Pick<NormalizedWorkshopTaskLineItem, 'quantity' | 'unitPrice'>

type WorkshopTaskSummary = {
  lineItems?: WorkshopLineItemSummary[]
}

type WorkshopOrderSummary = {
  id: string
  order_number?: string
  status: WorkshopOrderStatus
  createdAt: string
  vehicle_id?: string
  tasks?: WorkshopTaskSummary[]
  vehicle?: Vehicle | null
}

export type CustomerVehicleParty = components['schemas']['CustomerVehiclePartyDto']

export type CustomerVehicleRow = {
  key: string
  vehicle: { id: string; make: string; model: string; plate: string | null }
  vin: string | null
  role: CustomerVehicleParty['role']
  valid_from: string | null
  valid_to: string | null
  is_active: boolean
}

/**
 * Party rows, plus a read-time fallback: a vehicle linked only through `customer_id`, with no party
 * row at all, is listed as the owner because it is the customer's main contact.
 */
export function buildCustomerVehicleRows(customer: CustomerDetailResponse): CustomerVehicleRow[] {
  const vehicles = customer.vehicles ?? []
  const parties = customer.vehicle_parties ?? []
  const vinById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.vin ?? null]))
  const partyVehicleIds = new Set(parties.map((party) => party.vehicle_id))
  const partyRows: CustomerVehicleRow[] = parties.map((party) => ({
    key: party.id,
    vehicle: party.vehicle,
    vin: vinById.get(party.vehicle_id) ?? null,
    role: party.role,
    valid_from: party.valid_from,
    valid_to: party.valid_to,
    is_active: party.is_active,
  }))
  const fallbackRows: CustomerVehicleRow[] = vehicles
    .filter((vehicle) => !partyVehicleIds.has(vehicle.id))
    .map((vehicle) => ({
      key: `customer-id-${vehicle.id}`,
      vehicle: { id: vehicle.id, make: vehicle.make, model: vehicle.model, plate: vehicle.plate ?? null },
      vin: vehicle.vin ?? null,
      role: 'OWNER',
      valid_from: null,
      valid_to: null,
      is_active: true,
    }))
  return [...partyRows, ...fallbackRows]
}

export type InvoiceSummary = {
  id: string
  invoice_number: string | null
  status: InvoiceStatus
  date: string
  total_gross: string | number
}

export type CustomerDetailResponse = Customer & {
  sales_orders?: SalesOrderSummary[]
  workshop_orders?: WorkshopOrderSummary[]
  invoices?: InvoiceSummary[]
  vehicles?: Vehicle[]
  /** Vehicles by party role, including ended parties and previous owners. */
  vehicle_parties?: CustomerVehicleParty[]
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

function getWorkshopOrderTotal(order: WorkshopOrderSummary) {
  return (order.tasks ?? []).reduce((taskSum, task) => {
    const lineItems = task.lineItems ?? []
    const taskTotal = lineItems.reduce(
      (lineSum, line) => lineSum + toNumber(line.quantity) * toNumber(line.unitPrice),
      0,
    )
    return taskSum + taskTotal
  }, 0)
}

export function getCustomerDisplayName(customer: Pick<Customer, 'type' | 'company_name' | 'first_name' | 'last_name'>) {
  return customer.type === 'COMPANY' ? customer.company_name : `${customer.first_name} ${customer.last_name}`
}

/** Non-invoiced sales and workshop orders of the customer, newest first. */
export function getActiveOrders(customer: CustomerDetailResponse): ActiveOrderRow[] {
  const salesActive: ActiveOrderRow[] = (customer.sales_orders ?? [])
    .filter((order) => order.status !== 'INVOICED')
    .map((order) => ({
      id: order.id,
      type: 'Sales',
      number: order.order_number || `#${order.id.slice(0, 8)}`,
      createdAt: order.createdAt,
      status: order.status,
      total: toNumber(order.total_amount),
    }))

  const workshopActive: ActiveOrderRow[] = (customer.workshop_orders ?? [])
    .filter((order) => order.status !== 'INVOICED')
    .map((order) => ({
      id: order.id,
      type: 'Service',
      number: order.order_number ?? `#${order.id}`,
      createdAt: order.createdAt,
      status: order.status,
      total: getWorkshopOrderTotal(order),
    }))

  return [...salesActive, ...workshopActive].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}
