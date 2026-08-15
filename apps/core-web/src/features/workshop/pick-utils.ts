import type {
  WorkshopOrder,
  WorkshopOrderStatus,
} from '@/api/types'

export const PICK_ELIGIBLE_WORKSHOP_ORDER_STATUSES = new Set<WorkshopOrderStatus>([
  'INTAKE',
  'IN_PROGRESS',
])

export function getWorkshopCustomerDisplayName(order: WorkshopOrder) {
  if (!order.customer) return 'Dealer stock'
  if (order.customer.type === 'COMPANY' && order.customer.company_name) {
    return order.customer.company_name
  }

  return `${order.customer.first_name ?? ''} ${order.customer.last_name ?? ''}`.trim()
}

export interface WorkshopRequiredPartLine {
  workshopTaskLineItemId: string
  taskId: string
  taskTitle: string
  itemNo: string
  description: string
  requiredQuantity: number
}

export function getRequiredPartLines(order: WorkshopOrder | null | undefined): WorkshopRequiredPartLine[] {
  if (!order) return []

  const lines: WorkshopRequiredPartLine[] = []
  for (const task of order.tasks ?? []) {
    for (const lineItem of task.lineItems ?? []) {
      const requiredQuantity = Number(lineItem.qty)
      if (lineItem.type !== 'PART' || !Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
        continue
      }

      lines.push({
        workshopTaskLineItemId: lineItem.id,
        taskId: task.id,
        taskTitle: task.title,
        itemNo: lineItem.itemNo,
        description: lineItem.description,
        requiredQuantity,
      })
    }
  }

  return lines
}

export function isWorkshopOrderPickEligible(order: WorkshopOrder | null | undefined): boolean {
  if (!order) return false
  if (!PICK_ELIGIBLE_WORKSHOP_ORDER_STATUSES.has(order.status)) return false
  return getRequiredPartLines(order).length > 0
}

export function getTotalRequiredQuantity(lines: WorkshopRequiredPartLine[]): number {
  return lines.reduce((sum, line) => sum + line.requiredQuantity, 0)
}
