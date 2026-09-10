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
  laborStandardHours: number
  laborActualHours: number
  laborInternalCost: number
  hasLaborCostData: boolean
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

export function calculateTaskRawTotals(task: WorkshopTask): TaskTotals {
  const lineItems = task.lineItems ?? []
  const partsLines = lineItems.filter((li) => li.type === 'PART')
  const laborLines = lineItems.filter((li) => li.type === 'LABOR')

  const parts = partsLines.reduce((sum, li) => sum + li.qty * li.unitPrice, 0)
  const labor = laborLines.reduce((sum, li) => sum + li.qty * li.unitPrice, 0)

  const laborStandardHours = laborLines.reduce(
    (sum, li) => sum + (li.standardAw ?? 0),
    0,
  )
  const laborActualHours = laborLines.reduce(
    (sum, li) => sum + (li.actualHours ?? 0),
    0,
  )
  const laborInternalCost = laborLines.reduce((sum, li) => {
    if (li.internalCostRate == null) return sum
    const costHours = li.actualHours ?? li.qty
    return sum + costHours * li.internalCostRate
  }, 0)
  const hasLaborCostData = laborLines.some(
    (li) => li.internalCostRate != null,
  )

  return {
    parts,
    labor,
    total: parts + labor,
    laborStandardHours,
    laborActualHours,
    laborInternalCost,
    hasLaborCostData,
  }
}

export function createCheckoutLineSummary(
  row: { rowKey: string; taskId: string; lineItem: WorkshopTaskLineItem },
  lineDiscountOverrides: Record<string, DiscountState>,
  discountSeedFromInvoice: Record<string, DiscountState>,
  fetchedInvoice?: Invoice | null,
): CheckoutLineSummary {
  const { rowKey, taskId, lineItem } = row
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
}

export function groupCheckoutTasksByTask(
  tasks: WorkshopTask[],
  checkoutLineSummaryByRowKey: Map<string, CheckoutLineSummary>,
): GroupedCheckoutTask[] {
  return tasks.map((task) => {
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
  })
}

export function aggregateCheckoutSummaries(checkoutLineSummaries: CheckoutLineSummary[]) {
  const checkoutPartsTotal = checkoutLineSummaries
    .filter((l) => l.lineItem.type === 'PART')
    .reduce((sum, l) => sum + l.lineNet, 0)

  const checkoutLaborTotal = checkoutLineSummaries
    .filter((l) => l.lineItem.type === 'LABOR')
    .reduce((sum, l) => sum + l.lineNet, 0)

  const checkoutSubtotal = checkoutLineSummaries.reduce((sum, l) => sum + l.baseAmount, 0)
  const checkoutDiscountTotal = checkoutLineSummaries.reduce((sum, l) => sum + l.discountAmount, 0)
  const checkoutNetTotal = checkoutLineSummaries.reduce((sum, l) => sum + l.lineNet, 0)
  const checkoutTaxTotal = checkoutLineSummaries.reduce((sum, l) => sum + l.taxAmount, 0)
  const checkoutGrossTotal = checkoutNetTotal + checkoutTaxTotal

  return {
    checkoutPartsTotal,
    checkoutLaborTotal,
    checkoutSubtotal,
    checkoutDiscountTotal,
    checkoutNetTotal,
    checkoutTaxTotal,
    checkoutGrossTotal,
  }
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
        tasks.map((task) => [task.id, calculateTaskRawTotals(task)]),
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
  const baseOrderLaborInternalCostTotal = useMemo(
    () =>
      Array.from(rawTaskTotals.values()).reduce(
        (sum, t) => sum + t.laborInternalCost,
        0,
      ),
    [rawTaskTotals],
  )
  const hasOrderLaborCostData = useMemo(
    () => Array.from(rawTaskTotals.values()).some((t) => t.hasLaborCostData),
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
      checkoutLineRows.map((row) =>
        createCheckoutLineSummary(
          row,
          lineDiscountOverrides,
          discountSeedFromInvoice,
          fetchedInvoice,
        ),
      ),
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
    () => groupCheckoutTasksByTask(tasks, checkoutLineSummaryByRowKey),
    [checkoutLineSummaryByRowKey, tasks],
  )

  // ── Checkout aggregate totals ─────────────────────────────────────────
  const {
    checkoutPartsTotal,
    checkoutLaborTotal,
    checkoutSubtotal,
    checkoutDiscountTotal,
    checkoutNetTotal,
    checkoutTaxTotal,
    checkoutGrossTotal,
  } = useMemo(
    () => aggregateCheckoutSummaries(checkoutLineSummaries),
    [checkoutLineSummaries],
  )

  // ── View-aware order totals ───────────────────────────────────────────
  const orderPartsTotal = isCheckoutView ? checkoutPartsTotal : baseOrderPartsTotal
  const orderLaborTotal = isCheckoutView ? checkoutLaborTotal : baseOrderLaborTotal
  const orderGrandTotal = orderPartsTotal + orderLaborTotal
  const orderLaborRevenue = orderLaborTotal
  const orderLaborInternalCostTotal = baseOrderLaborInternalCostTotal
  const orderLaborMarginPercent =
    hasOrderLaborCostData && orderLaborRevenue > 0
      ? ((orderLaborRevenue - orderLaborInternalCostTotal) / orderLaborRevenue) * 100
      : null

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
    orderLaborRevenue,
    orderLaborInternalCostTotal,
    orderLaborMarginPercent,
    hasOrderLaborCostData,
  }
}
