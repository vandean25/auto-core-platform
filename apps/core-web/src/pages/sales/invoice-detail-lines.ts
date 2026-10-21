import type { Invoice, InvoiceItem, WorkshopTask } from '@/api/types'
import { calculateDiscountAmount, parseDiscountValue } from '@/lib/discount'
import { formatCurrency } from '@/lib/utils'

export interface InvoiceLineSummary {
  item: InvoiceItem
  discountAmount: number
  netAfterDiscount: number
}

interface TaskRenderGroup {
  key: string
  title: string
  lines: InvoiceLineSummary[]
}

export function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildLineSignature(description: string, quantity: unknown, unitPrice: unknown) {
  return `${description.trim().toLowerCase()}|${toNumber(quantity).toFixed(4)}|${toNumber(unitPrice).toFixed(4)}`
}

export function formatNumber(value: number) {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function formatDiscountPercent(value: number) {
  if (Number.isInteger(value)) return `${value}%`
  return `${value.toFixed(2).replace(/\.?0+$/, '')}%`
}

function buildTaskGroups(
  tasks: WorkshopTask[],
  lineSummaries: InvoiceLineSummary[],
  additionalItemsTitle: string,
): TaskRenderGroup[] {
  const remainingBySignature = new Map<string, InvoiceLineSummary[]>()
  lineSummaries.forEach((line) => {
    const signature = buildLineSignature(
      line.item.description,
      line.item.quantity,
      line.item.unit_price,
    )
    const bucket = remainingBySignature.get(signature) ?? []
    bucket.push(line)
    remainingBySignature.set(signature, bucket)
  })

  const groups: TaskRenderGroup[] = []

  tasks.forEach((task) => {
    const taskLines = task.lineItems ?? []
    const matched: InvoiceLineSummary[] = []

    taskLines.forEach((line) => {
      const signature = buildLineSignature(line.description, line.qty, line.unitPrice)
      const bucket = remainingBySignature.get(signature)
      if (!bucket || bucket.length === 0) return

      const match = bucket.shift()
      if (!match) return
      if (bucket.length === 0) {
        remainingBySignature.delete(signature)
      } else {
        remainingBySignature.set(signature, bucket)
      }
      matched.push(match)
    })

    if (matched.length > 0) {
      groups.push({
        key: task.id,
        title: task.title,
        lines: matched,
      })
    }
  })

  const leftovers: InvoiceLineSummary[] = []
  remainingBySignature.forEach((bucket) => {
    leftovers.push(...bucket)
  })

  if (leftovers.length > 0) {
    groups.push({
      key: 'additional-items',
      title: additionalItemsTitle,
      lines: leftovers,
    })
  }

  return groups
}

export function formatLineDiscount(summary: InvoiceLineSummary) {
  if (summary.discountAmount <= 0) return '—'

  const rawDiscountValue = parseDiscountValue(summary.item.line_discount_value)
  if (summary.item.line_discount_type === 'PERCENTAGE' && rawDiscountValue !== null) {
    return formatDiscountPercent(Math.min(rawDiscountValue, 100))
  }
  return `-${formatCurrency(summary.discountAmount)}`
}

export function summarizeInvoiceLine(item: InvoiceItem): InvoiceLineSummary {
  const baseNet = toNumber(item.quantity) * toNumber(item.unit_price)
  const lineDiscountAmount = calculateDiscountAmount(
    baseNet,
    item.line_discount_type,
    parseDiscountValue(item.line_discount_value),
  )
  return {
    item,
    discountAmount: lineDiscountAmount,
    netAfterDiscount: Math.max(0, baseNet - lineDiscountAmount),
  }
}

/** Line discounts plus the global discount, which applies to the subtotal after line discounts. */
export function calculateTotalSavings(invoice: Invoice, lineSummaries: InvoiceLineSummary[]) {
  const lineDiscountTotal = lineSummaries.reduce((sum, line) => sum + line.discountAmount, 0)
  const subtotalAfterLineDiscount = lineSummaries.reduce((sum, line) => sum + line.netAfterDiscount, 0)
  const globalDiscountAmount = calculateDiscountAmount(
    subtotalAfterLineDiscount,
    invoice.global_discount_type,
    parseDiscountValue(invoice.global_discount_value),
  )
  return lineDiscountTotal + globalDiscountAmount
}

/** Groups lines under the workshop tasks they match; without task matches, one fallback group holds all lines. */
export function groupLinesByTask(
  tasks: WorkshopTask[] | undefined,
  lineSummaries: InvoiceLineSummary[],
  titles: { additionalItems: string; workshopTasks: string },
): TaskRenderGroup[] {
  const groupsFromTasks =
    tasks && tasks.length > 0 ? buildTaskGroups(tasks, lineSummaries, titles.additionalItems) : []

  if (groupsFromTasks.length > 0) {
    return groupsFromTasks
  }

  return lineSummaries.length > 0
    ? [
        {
          key: 'workshop-fallback',
          title: titles.workshopTasks,
          lines: lineSummaries,
        },
      ]
    : []
}
