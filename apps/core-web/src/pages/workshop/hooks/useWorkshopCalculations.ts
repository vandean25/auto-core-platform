import { useMemo } from 'react'
import { calculateDiscountAmount, parseDiscountValue } from '@/lib/discount'
import type {
  DiscountType,
  InvoiceItem,
  WorkshopTask,
  WorkshopTaskLineItem,
} from '@/api/types'
import type { Invoice } from '@/api/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscountState {
  type: DiscountType | null
  value: string
}

export interface CheckoutLineSummary {
  rowKey: string
  taskId: string
  lineItem: WorkshopTaskLineItem
  discount: DiscountState
  baseAmount: number
  discountAmount: number
  lineNet: number
  taxAmount: number
}

export interface GroupedCheckoutTask {
  task: WorkshopTask
  lines: CheckoutLineSummary[]
  subtotal: number
  discountTotal: number
  netTotal: number
}

export interface TaskTotals {
  parts: number
  labor: number
  total: number
}

interface UseWorkshopCalculationsInput {
  /** The raw tasks from the workshop order (may be undefined). */
  orderTasks: WorkshopTask[] | undefined
  /** Per-task line item overrides from optimistic updates. */
  taskLineItemOverrides: Record<string, WorkshopTask['lineItems']>
  /** Per-line discount overrides set by the user in the checkout view. */
  lineDiscountOverrides: Record<string, DiscountState>
  /** The fetched invoice (if any) used for discount seeding and tax rates. */
  fetchedInvoice: Invoice | null | undefined
  /** Whether the checkout view is currently active (affects which totals to surface). */
  isCheckoutView: boolean
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

export const EMPTY_DISCOUNT_STATE: DiscountState = { type: null, value: '' }

export function buildTaskLineRowKey(
  taskId: string,
  lineItemId: string | undefined,
  index: number,
): string {
  return `${taskId}:${lineItemId ?? `idx-${index}`}`
}

export function findInvoiceItemByLineItemId(
  invoiceItems: InvoiceItem[],
  lineItemId: string,
): InvoiceItem | undefined {
  return invoiceItems.find((item) => item.id === lineItemId)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkshopCalculations({
  orderTasks,
  taskLineItemOverrides,
  lineDiscountOverrides,
  fetchedInvoice,
  isCheckoutView,
}: UseWorkshopCalculationsInput) {
  // ── Normalize tasks with overrides ────────────────────────────────────
  const tasks = useMemo<WorkshopTask[]>(
    () =>
      (orderTasks ?? []).map((task) => ({
        ...task,
        lineItems: taskLineItemOverrides[task.id] ?? task.lineItems ?? [],
        mechanicNotes: task.mechanicNotes ?? '',
      })),
    [orderTasks, taskLineItemOverrides],
  )

  // ── Per-task raw totals (no discounts) ────────────────────────────────
  const rawTaskTotals = useMemo(
    () =>
      new Map<string, TaskTotals>(
        tasks.map((task) => {
          const lineItems = task.lineItems ?? []
          const parts = lineItems
            .filter((li) => li.type === 'PART')
            .reduce((sum, li) => sum + li.qty * li.unitPrice, 0)
          const labor = lineItems
            .filter((li) => li.type === 'LABOR')
            .reduce((sum, li) => sum + li.qty * li.unitPrice, 0)
          return [task.id, { parts, labor, total: parts + labor }]
        }),
      ),
    [tasks],
  )

  // ── Base order totals (pre-discount) ──────────────────────────────────
  const baseOrderPartsTotal = useMemo(
    () => Array.from(rawTaskTotals.values()).reduce((sum, t) => sum + t.parts, 0),
    [rawTaskTotals],
  )
  const baseOrderLaborTotal = useMemo(
    () => Array.from(rawTaskTotals.values()).reduce((sum, t) => sum + t.labor, 0),
    [rawTaskTotals],
  )

  // ── Flat list of checkout line rows ───────────────────────────────────
  const checkoutLineRows = useMemo(
    () =>
      tasks.flatMap((task) =>
        (task.lineItems ?? []).map((lineItem, index) => ({
          rowKey: buildTaskLineRowKey(task.id, lineItem.id, index),
          taskId: task.id,
          lineItem,
        })),
      ),
    [tasks],
  )

  // ── Discount seed from existing invoice ───────────────────────────────
  const discountSeedFromInvoice = useMemo(() => {
    const seed: Record<string, DiscountState> = {}
    if (!fetchedInvoice) return seed

    checkoutLineRows.forEach((lineRow) => {
      const invoiceItem = findInvoiceItemByLineItemId(fetchedInvoice.items, lineRow.lineItem.id)
      if (!invoiceItem) return
      seed[lineRow.rowKey] = {
        type: invoiceItem.line_discount_type ?? null,
        value:
          invoiceItem.line_discount_value !== null &&
          invoiceItem.line_discount_value !== undefined
            ? String(invoiceItem.line_discount_value)
            : '',
      }
    })

    return seed
  }, [checkoutLineRows, fetchedInvoice])

  // ── Per-line summaries (base, discount, net, tax) ─────────────────────
  const checkoutLineSummaries = useMemo<CheckoutLineSummary[]>(
    () =>
      checkoutLineRows.map(({ rowKey, taskId, lineItem }) => {
        const baseAmount = lineItem.qty * lineItem.unitPrice
        const discount =
          lineDiscountOverrides[rowKey] ??
          discountSeedFromInvoice[rowKey] ??
          EMPTY_DISCOUNT_STATE
        const discountAmount = calculateDiscountAmount(
          baseAmount,
          discount.type,
          parseDiscountValue(discount.value),
        )
        const lineNet = Math.max(0, baseAmount - discountAmount)
        const invoiceItem = fetchedInvoice
          ? findInvoiceItemByLineItemId(fetchedInvoice.items, lineItem.id)
          : undefined
        const lineTaxRate = Number(invoiceItem?.tax_rate ?? 0)
        const taxAmount = lineNet * (lineTaxRate / 100)
        return {
          rowKey,
          taskId,
          lineItem,
          discount,
          baseAmount,
          discountAmount,
          lineNet,
          taxAmount,
        }
      }),
    [checkoutLineRows, discountSeedFromInvoice, fetchedInvoice, lineDiscountOverrides],
  )

  // ── Lookup maps ───────────────────────────────────────────────────────
  const checkoutLineSummaryByRowKey = useMemo(
    () => new Map(checkoutLineSummaries.map((s) => [s.rowKey, s])),
    [checkoutLineSummaries],
  )
  const checkoutLineRowByRowKey = useMemo(
    () => new Map(checkoutLineRows.map((r) => [r.rowKey, r])),
    [checkoutLineRows],
  )

  // ── Grouped checkout tasks ────────────────────────────────────────────
  const groupedCheckoutTasks = useMemo<GroupedCheckoutTask[]>(
    () =>
      tasks.map((task) => {
        const lines = (task.lineItems ?? [])
          .map((lineItem, index) => {
            const rowKey = buildTaskLineRowKey(task.id, lineItem.id, index)
            return checkoutLineSummaryByRowKey.get(rowKey) ?? null
          })
          .filter((line): line is CheckoutLineSummary => line !== null)

        const subtotal = lines.reduce((sum, l) => sum + l.baseAmount, 0)
        const discountTotal = lines.reduce((sum, l) => sum + l.discountAmount, 0)
        const netTotal = lines.reduce((sum, l) => sum + l.lineNet, 0)

        return { task, lines, subtotal, discountTotal, netTotal }
      }),
    [checkoutLineSummaryByRowKey, tasks],
  )

  // ── Checkout totals (post-discount, by type) ──────────────────────────
  const checkoutPartsTotal = useMemo(
    () =>
      checkoutLineSummaries
        .filter((l) => l.lineItem.type === 'PART')
        .reduce((sum, l) => sum + l.lineNet, 0),
    [checkoutLineSummaries],
  )
  const checkoutLaborTotal = useMemo(
    () =>
      checkoutLineSummaries
        .filter((l) => l.lineItem.type === 'LABOR')
        .reduce((sum, l) => sum + l.lineNet, 0),
    [checkoutLineSummaries],
  )

  // ── Checkout aggregate totals ─────────────────────────────────────────
  const checkoutSubtotal = useMemo(
    () => checkoutLineSummaries.reduce((sum, l) => sum + l.baseAmount, 0),
    [checkoutLineSummaries],
  )
  const checkoutDiscountTotal = useMemo(
    () => checkoutLineSummaries.reduce((sum, l) => sum + l.discountAmount, 0),
    [checkoutLineSummaries],
  )
  const checkoutNetTotal = useMemo(
    () => checkoutLineSummaries.reduce((sum, l) => sum + l.lineNet, 0),
    [checkoutLineSummaries],
  )
  const checkoutTaxTotal = useMemo(
    () => checkoutLineSummaries.reduce((sum, l) => sum + l.taxAmount, 0),
    [checkoutLineSummaries],
  )
  const checkoutGrossTotal = checkoutNetTotal + checkoutTaxTotal

  // ── View-aware order totals ───────────────────────────────────────────
  const orderPartsTotal = isCheckoutView ? checkoutPartsTotal : baseOrderPartsTotal
  const orderLaborTotal = isCheckoutView ? checkoutLaborTotal : baseOrderLaborTotal
  const orderGrandTotal = orderPartsTotal + orderLaborTotal

  return {
    // Normalized tasks
    tasks,
    // Per-task raw totals
    rawTaskTotals,
    // Base order totals
    baseOrderPartsTotal,
    baseOrderLaborTotal,
    // Checkout structures
    checkoutLineRows,
    checkoutLineSummaries,
    checkoutLineSummaryByRowKey,
    checkoutLineRowByRowKey,
    groupedCheckoutTasks,
    // Discount seed (needed by parent handlers for inline discount edits)
    discountSeedFromInvoice,
    // Checkout totals
    checkoutPartsTotal,
    checkoutLaborTotal,
    checkoutSubtotal,
    checkoutDiscountTotal,
    checkoutNetTotal,
    checkoutTaxTotal,
    checkoutGrossTotal,
    // View-aware totals
    orderPartsTotal,
    orderLaborTotal,
    orderGrandTotal,
  }
}
