import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillLine } from '../types'
import { AUTO_SAVE_DEBOUNCE_MS, usePurchaseBillAutosave } from './usePurchaseBillAutosave'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const line: BillLine = {
  tempId: 'line-1',
  source: 'manual',
  description: 'Part A',
  quantity: 1,
  unitCost: 100,
  taxRate: 20,
}

describe('usePurchaseBillAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not save in create mode', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => usePurchaseBillAutosave({ enabled: false, save }))

    act(() => {
      result.current.triggerAutoSave({
        vendorId: 'vendor-1',
        vendorInvoiceNumber: 'INV-1',
        invoiceDate: '2026-03-29',
        dueDate: '2026-04-28',
        lines: [line],
      })
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(save).not.toHaveBeenCalled()
  })

  it('debounces save by 750ms in edit mode', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => usePurchaseBillAutosave({ enabled: true, save }))

    act(() => {
      result.current.triggerAutoSave({
        vendorId: 'vendor-1',
        vendorInvoiceNumber: 'INV-UPDATED',
        invoiceDate: '2026-03-29',
        dueDate: '2026-04-28',
        lines: [line],
      })
    })

    expect(save).not.toHaveBeenCalled()
    expect(result.current.saveStatus).toBe('saved')

    act(() => {
      vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS - 1)
    })
    expect(save).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorInvoiceNumber: 'INV-UPDATED',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(result.current.saveStatus).toBe('saved')
  })

  it('collapses rapid edits into a single save of the latest snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => usePurchaseBillAutosave({ enabled: true, save }))

    act(() => {
      result.current.triggerAutoSave({
        vendorId: 'vendor-1',
        vendorInvoiceNumber: 'INV-1',
        invoiceDate: '2026-03-29',
        dueDate: '2026-04-28',
        lines: [line],
      })
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    act(() => {
      result.current.triggerAutoSave({
        vendorId: 'vendor-1',
        vendorInvoiceNumber: 'INV-2',
        invoiceDate: '2026-03-29',
        dueDate: '2026-04-28',
        lines: [line],
      })
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ vendorInvoiceNumber: 'INV-2' }),
    )
  })

  it('skips save when vendor or invoice number is missing', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => usePurchaseBillAutosave({ enabled: true, save }))

    act(() => {
      result.current.triggerAutoSave({
        vendorId: '',
        vendorInvoiceNumber: 'INV-1',
        invoiceDate: '2026-03-29',
        dueDate: '2026-04-28',
        lines: [line],
      })
    })
    act(() => {
      result.current.triggerAutoSave({
        vendorId: 'vendor-1',
        vendorInvoiceNumber: '   ',
        invoiceDate: '2026-03-29',
        dueDate: '2026-04-28',
        lines: [line],
        immediate: true,
      })
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(save).not.toHaveBeenCalled()
  })

  it('sets saveStatus to error when save rejects a non-abort error', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => usePurchaseBillAutosave({ enabled: true, save }))

    act(() => {
      result.current.triggerAutoSave({
        vendorId: 'vendor-1',
        vendorInvoiceNumber: 'INV-1',
        invoiceDate: '2026-03-29',
        dueDate: '2026-04-28',
        lines: [line],
        immediate: true,
      })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.saveStatus).toBe('error')
  })
})
