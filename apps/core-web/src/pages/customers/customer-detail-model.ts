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
