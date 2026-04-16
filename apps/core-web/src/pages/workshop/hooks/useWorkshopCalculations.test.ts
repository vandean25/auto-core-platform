import { renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import {
  useWorkshopCalculations,
  buildTaskLineRowKey,
  findInvoiceItemByLineItemId,
} from './useWorkshopCalculations'
import type { WorkshopTask } from '@/api/types'
import type { DiscountState } from './useWorkshopCalculations'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const partLine = {
  id: 'line-1',
  type: 'PART' as const,
  itemNo: 'OIL-FLTR',
  description: 'Oil Filter',
  qty: 1,
  unitPrice: 15,
}

const laborLine = {
  id: 'line-2',
  type: 'LABOR' as const,
  itemNo: 'LAB-01',
  description: 'Oil change labor',
  qty: 0.5,
  unitPrice: 80,
  standardAw: 0.5,
  actualHours: 0.75,
  internalCostRate: 30,
}

const brakePads = {
  id: 'line-3',
  type: 'PART' as const,
  itemNo: 'BRK-PAD',
  description: 'Brake Pads',
  qty: 2,
  unitPrice: 50,
}

const singleTask: WorkshopTask = {
  id: 'task-1',
  title: 'Oil Change',
  status: 'IN_PROGRESS',
  done: false,
  lineItems: [partLine, laborLine],
}

const brakeTask: WorkshopTask = {
  id: 'task-2',
  title: 'Brake Inspection',
  status: 'DONE',
  done: true,
  lineItems: [brakePads],
}

const defaultInput = {
  orderTasks: [singleTask] as WorkshopTask[],
  taskLineItemOverrides: {} as Record<string, WorkshopTask['lineItems']>,
  lineDiscountOverrides: {} as Record<string, DiscountState>,
  fetchedInvoice: null,
  isCheckoutView: false,
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('buildTaskLineRowKey', () => {
  it('builds key with lineItem id', () => {
    expect(buildTaskLineRowKey('task-1', 'line-1', 0)).toBe('task-1:line-1')
  })

  it('falls back to index when lineItem id is undefined', () => {
    expect(buildTaskLineRowKey('task-1', undefined, 3)).toBe('task-1:idx-3')
  })
})

describe('findInvoiceItemByLineItemId', () => {
  const items = [
    { id: 'line-1', description: 'Oil Filter', quantity: 1, unit_price: 15, tax_rate: 21 },
    { id: 'line-2', description: 'Labor', quantity: 0.5, unit_price: 80, tax_rate: 0 },
  ] as any[]

  it('returns matching invoice item', () => {
    expect(findInvoiceItemByLineItemId(items, 'line-1')?.description).toBe('Oil Filter')
  })

  it('returns undefined for non-existent id', () => {
    expect(findInvoiceItemByLineItemId(items, 'line-999')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Hook: tasks normalization
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — tasks normalization', () => {
  it('returns empty array when orderTasks is undefined', () => {
    const { result } = renderHook(() =>
      useWorkshopCalculations({ ...defaultInput, orderTasks: undefined }),
    )
    expect(result.current.tasks).toEqual([])
  })

  it('normalizes tasks with missing lineItems and mechanicNotes', () => {
    const rawTask = { id: 't', title: 'X', status: 'IN_PROGRESS' as const, done: false }
    const { result } = renderHook(() =>
      useWorkshopCalculations({ ...defaultInput, orderTasks: [rawTask] }),
    )
    expect(result.current.tasks[0].lineItems).toEqual([])
    expect(result.current.tasks[0].mechanicNotes).toBe('')
  })

  it('applies taskLineItemOverrides over raw lineItems', () => {
    const override = [{ ...partLine, unitPrice: 999 }]
    const { result } = renderHook(() =>
      useWorkshopCalculations({
        ...defaultInput,
        taskLineItemOverrides: { 'task-1': override },
      }),
    )
    expect(result.current.tasks[0].lineItems![0].unitPrice).toBe(999)
  })
})

// ---------------------------------------------------------------------------
// Hook: rawTaskTotals
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — rawTaskTotals', () => {
  it('calculates parts and labor totals per task', () => {
    const { result } = renderHook(() => useWorkshopCalculations(defaultInput))
    const totals = result.current.rawTaskTotals.get('task-1')!
    expect(totals.parts).toBe(15) // 1 * 15
    expect(totals.labor).toBe(40) // 0.5 * 80
    expect(totals.total).toBe(55)
  })

  it('returns zero totals for tasks with no line items', () => {
    const emptyTask: WorkshopTask = {
      id: 'empty',
      title: 'Empty',
      status: 'IN_PROGRESS',
      done: false,
      lineItems: [],
    }
    const { result } = renderHook(() =>
      useWorkshopCalculations({ ...defaultInput, orderTasks: [emptyTask] }),
    )
    const totals = result.current.rawTaskTotals.get('empty')!
    expect(totals.parts).toBe(0)
    expect(totals.labor).toBe(0)
    expect(totals.total).toBe(0)
  })

  it('includes labor hours and internal cost analytics per task', () => {
    const { result } = renderHook(() => useWorkshopCalculations(defaultInput))
    const totals = result.current.rawTaskTotals.get('task-1')!

    expect(totals.laborStandardHours).toBe(0.5)
    expect(totals.laborActualHours).toBe(0.75)
    expect(totals.laborInternalCost).toBe(22.5)
    expect(totals.hasLaborCostData).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Hook: base order totals
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — base order totals', () => {
  it('sums parts and labor across all tasks', () => {
    const { result } = renderHook(() =>
      useWorkshopCalculations({ ...defaultInput, orderTasks: [singleTask, brakeTask] }),
    )
    // singleTask: parts=15, labor=40
    // brakeTask: parts=100, labor=0
    expect(result.current.baseOrderPartsTotal).toBe(115)
    expect(result.current.baseOrderLaborTotal).toBe(40)
  })
})

// ---------------------------------------------------------------------------
// Hook: checkout line rows
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — checkoutLineRows', () => {
  it('flattens all task line items into rows with rowKeys', () => {
    const { result } = renderHook(() =>
      useWorkshopCalculations({ ...defaultInput, orderTasks: [singleTask, brakeTask] }),
    )
    expect(result.current.checkoutLineRows).toHaveLength(3)
    expect(result.current.checkoutLineRows[0].rowKey).toBe('task-1:line-1')
    expect(result.current.checkoutLineRows[1].rowKey).toBe('task-1:line-2')
    expect(result.current.checkoutLineRows[2].rowKey).toBe('task-2:line-3')
  })
})

// ---------------------------------------------------------------------------
// Hook: checkout summaries (no discounts)
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — checkoutLineSummaries (no discounts)', () => {
  it('calculates base amount and zero discount without overrides', () => {
    const { result } = renderHook(() => useWorkshopCalculations(defaultInput))
    const summaries = result.current.checkoutLineSummaries
    expect(summaries).toHaveLength(2)

    // Oil Filter: 1 * 15 = 15
    expect(summaries[0].baseAmount).toBe(15)
    expect(summaries[0].discountAmount).toBe(0)
    expect(summaries[0].lineNet).toBe(15)
    expect(summaries[0].taxAmount).toBe(0) // no invoice → tax_rate=0

    // Labor: 0.5 * 80 = 40
    expect(summaries[1].baseAmount).toBe(40)
    expect(summaries[1].lineNet).toBe(40)
  })
})

// ---------------------------------------------------------------------------
// Hook: checkout summaries with discounts
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — checkoutLineSummaries (with discounts)', () => {
  it('applies percentage discount override to a line', () => {
    const overrides: Record<string, DiscountState> = {
      'task-1:line-1': { type: 'PERCENTAGE', value: '10' },
    }
    const { result } = renderHook(() =>
      useWorkshopCalculations({
        ...defaultInput,
        lineDiscountOverrides: overrides,
      }),
    )
    const partSummary = result.current.checkoutLineSummaries[0]
    // 15 * 10% = 1.50 discount
    expect(partSummary.discountAmount).toBe(1.5)
    expect(partSummary.lineNet).toBe(13.5)
  })

  it('applies flat amount discount override', () => {
    const overrides: Record<string, DiscountState> = {
      'task-1:line-2': { type: 'FLAT_AMOUNT', value: '5' },
    }
    const { result } = renderHook(() =>
      useWorkshopCalculations({
        ...defaultInput,
        lineDiscountOverrides: overrides,
      }),
    )
    const laborSummary = result.current.checkoutLineSummaries[1]
    // 40 - 5 = 35
    expect(laborSummary.discountAmount).toBe(5)
    expect(laborSummary.lineNet).toBe(35)
  })

  it('caps flat discount at line base amount (never negative net)', () => {
    const overrides: Record<string, DiscountState> = {
      'task-1:line-1': { type: 'FLAT_AMOUNT', value: '999' },
    }
    const { result } = renderHook(() =>
      useWorkshopCalculations({
        ...defaultInput,
        lineDiscountOverrides: overrides,
      }),
    )
    const partSummary = result.current.checkoutLineSummaries[0]
    expect(partSummary.discountAmount).toBe(15) // capped at base
    expect(partSummary.lineNet).toBe(0)
  })

  it('seeds discount from invoice when no override is present', () => {
    const invoice = {
      id: 'inv-1',
      items: [
        {
          id: 'line-1',
          description: 'Oil Filter',
          quantity: 1,
          unit_price: 15,
          tax_rate: 21,
          line_discount_type: 'PERCENTAGE' as const,
          line_discount_value: 20,
        },
      ],
    } as any

    const { result } = renderHook(() =>
      useWorkshopCalculations({
        ...defaultInput,
        fetchedInvoice: invoice,
      }),
    )
    const partSummary = result.current.checkoutLineSummaries[0]
    // 15 * 20% = 3 discount
    expect(partSummary.discountAmount).toBe(3)
    expect(partSummary.lineNet).toBe(12)
  })

  it('user override takes precedence over invoice seed', () => {
    const invoice = {
      id: 'inv-1',
      items: [
        {
          id: 'line-1',
          description: 'Oil Filter',
          quantity: 1,
          unit_price: 15,
          tax_rate: 21,
          line_discount_type: 'PERCENTAGE' as const,
          line_discount_value: 20,
        },
      ],
    } as any

    const overrides: Record<string, DiscountState> = {
      'task-1:line-1': { type: 'FLAT_AMOUNT', value: '2' },
    }

    const { result } = renderHook(() =>
      useWorkshopCalculations({
        ...defaultInput,
        fetchedInvoice: invoice,
        lineDiscountOverrides: overrides,
      }),
    )
    const partSummary = result.current.checkoutLineSummaries[0]
    // Override: flat 2, not the invoice's 20%
    expect(partSummary.discountAmount).toBe(2)
    expect(partSummary.lineNet).toBe(13)
  })
})

// ---------------------------------------------------------------------------
// Hook: tax calculation
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — tax calculation', () => {
  it('computes tax from invoice item tax_rate', () => {
    const invoice = {
      id: 'inv-1',
      items: [
        { id: 'line-1', quantity: 1, unit_price: 15, tax_rate: 21 },
        { id: 'line-2', quantity: 0.5, unit_price: 80, tax_rate: 0 },
      ],
    } as any

    const { result } = renderHook(() =>
      useWorkshopCalculations({ ...defaultInput, fetchedInvoice: invoice }),
    )

    // Oil Filter: net=15, tax=15*0.21=3.15
    expect(result.current.checkoutLineSummaries[0].taxAmount).toBeCloseTo(3.15)
    // Labor: net=40, tax=40*0=0
    expect(result.current.checkoutLineSummaries[1].taxAmount).toBe(0)
    expect(result.current.checkoutTaxTotal).toBeCloseTo(3.15)
  })
})

// ---------------------------------------------------------------------------
// Hook: groupedCheckoutTasks
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — groupedCheckoutTasks', () => {
  it('groups line summaries by task', () => {
    const { result } = renderHook(() =>
      useWorkshopCalculations({
        ...defaultInput,
        orderTasks: [singleTask, brakeTask],
      }),
    )
    const groups = result.current.groupedCheckoutTasks
    expect(groups).toHaveLength(2)

    expect(groups[0].task.id).toBe('task-1')
    expect(groups[0].lines).toHaveLength(2)
    expect(groups[0].netTotal).toBe(55) // 15 + 40

    expect(groups[1].task.id).toBe('task-2')
    expect(groups[1].lines).toHaveLength(1)
    expect(groups[1].netTotal).toBe(100) // 2 * 50
  })

  it('returns empty lines for task with no line items', () => {
    const emptyTask: WorkshopTask = {
      id: 'empty',
      title: 'Nothing',
      status: 'IN_PROGRESS',
      done: false,
      lineItems: [],
    }
    const { result } = renderHook(() =>
      useWorkshopCalculations({ ...defaultInput, orderTasks: [emptyTask] }),
    )
    expect(result.current.groupedCheckoutTasks[0].lines).toHaveLength(0)
    expect(result.current.groupedCheckoutTasks[0].netTotal).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Hook: checkout aggregate totals
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — checkout aggregate totals', () => {
  it('computes subtotal, discount, net, tax, gross', () => {
    const invoice = {
      id: 'inv-1',
      items: [
        { id: 'line-1', quantity: 1, unit_price: 15, tax_rate: 21 },
        { id: 'line-2', quantity: 0.5, unit_price: 80, tax_rate: 0 },
        { id: 'line-3', quantity: 2, unit_price: 50, tax_rate: 10 },
      ],
    } as any

    const { result } = renderHook(() =>
      useWorkshopCalculations({
        ...defaultInput,
        orderTasks: [singleTask, brakeTask],
        fetchedInvoice: invoice,
      }),
    )

    // Subtotal: 15 + 40 + 100 = 155
    expect(result.current.checkoutSubtotal).toBe(155)
    // No discounts → discount total = 0
    expect(result.current.checkoutDiscountTotal).toBe(0)
    // Net = subtotal (no discounts)
    expect(result.current.checkoutNetTotal).toBe(155)
    // Tax: 15*0.21 + 40*0 + 100*0.10 = 3.15 + 0 + 10 = 13.15
    expect(result.current.checkoutTaxTotal).toBeCloseTo(13.15)
    // Gross: 155 + 13.15 = 168.15
    expect(result.current.checkoutGrossTotal).toBeCloseTo(168.15)
  })
})

// ---------------------------------------------------------------------------
// Hook: view-aware order totals
// ---------------------------------------------------------------------------

describe('useWorkshopCalculations — view-aware order totals', () => {
  it('returns base totals when not in checkout view', () => {
    const { result } = renderHook(() =>
      useWorkshopCalculations({ ...defaultInput, isCheckoutView: false }),
    )
    expect(result.current.orderPartsTotal).toBe(15)
    expect(result.current.orderLaborTotal).toBe(40)
    expect(result.current.orderGrandTotal).toBe(55)
  })

  it('returns checkout totals when in checkout view', () => {
    const overrides: Record<string, DiscountState> = {
      'task-1:line-1': { type: 'PERCENTAGE', value: '10' },
    }
    const { result } = renderHook(() =>
      useWorkshopCalculations({
        ...defaultInput,
        isCheckoutView: true,
        lineDiscountOverrides: overrides,
      }),
    )
    // Parts: 15 - 1.5 = 13.5 (discounted)
    expect(result.current.orderPartsTotal).toBe(13.5)
    // Labor: unchanged = 40
    expect(result.current.orderLaborTotal).toBe(40)
    expect(result.current.orderGrandTotal).toBe(53.5)
  })

  it('returns order-level labor revenue, internal cost, and margin when cost data exists', () => {
    const { result } = renderHook(() =>
      useWorkshopCalculations({ ...defaultInput, isCheckoutView: false }),
    )

    expect(result.current.orderLaborRevenue).toBe(40)
    expect(result.current.orderLaborInternalCostTotal).toBe(22.5)
    expect(result.current.orderLaborMarginPercent).toBeCloseTo(43.75)
    expect(result.current.hasOrderLaborCostData).toBe(true)
  })
})
