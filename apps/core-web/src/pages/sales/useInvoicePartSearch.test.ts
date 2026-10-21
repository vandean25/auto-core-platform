import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as inventoryApi from '@/api/inventory'
import type { InventoryItem } from '@/api/types'
import { useInvoicePartSearch } from './useInvoicePartSearch'

vi.mock('@/api/inventory')

const part = {
  id: 'part-1',
  name: 'Bremsscheibe',
  sku: 'BS-1',
  price: 45,
  quantity_available: 3,
} as unknown as InventoryItem

const mockInventory = (data: unknown) =>
  vi
    .mocked(inventoryApi.useInventory)
    .mockReturnValue({ data } as unknown as ReturnType<typeof inventoryApi.useInventory>)

describe('useInvoicePartSearch', () => {
  beforeEach(() => {
    mockInventory({ data: [part] })
  })

  it('offers the parts the inventory returned', () => {
    const { result } = renderHook(() => useInvoicePartSearch(vi.fn()))

    expect(result.current.inventoryItems).toEqual([part])
  })

  it('offers no parts while the inventory has no data', () => {
    mockInventory(undefined)

    const { result } = renderHook(() => useInvoicePartSearch(vi.fn()))

    expect(result.current.inventoryItems).toEqual([])
  })

  it('searches the inventory with the text the user typed', () => {
    const { result } = renderHook(() => useInvoicePartSearch(vi.fn()))

    act(() => {
      result.current.setInventorySearch('brake')
    })

    expect(inventoryApi.useInventory).toHaveBeenLastCalledWith({ search: 'brake', pageSize: 10 })
  })

  it('fills the line it was opened for with the picked part and closes the dialog', () => {
    const updateItem = vi.fn()
    const { result } = renderHook(() => useInvoicePartSearch(updateItem))

    act(() => {
      result.current.openPartSearch(1)
    })
    expect(result.current.partSearchOpen).toBe(true)

    act(() => {
      result.current.handleSelectPart(part)
    })

    expect(updateItem).toHaveBeenCalledWith(1, {
      catalog_item_id: 'part-1',
      description: 'Bremsscheibe',
      unit_price: 45,
      tax_rate: 20,
    })
    expect(result.current.partSearchOpen).toBe(false)
  })

  it('closes the dialog and touches no line when a part is picked with no line opened', () => {
    const updateItem = vi.fn()
    const { result } = renderHook(() => useInvoicePartSearch(updateItem))

    act(() => {
      result.current.setPartSearchOpen(true)
    })
    act(() => {
      result.current.handleSelectPart(part)
    })

    expect(updateItem).not.toHaveBeenCalled()
    expect(result.current.partSearchOpen).toBe(false)
  })
})
