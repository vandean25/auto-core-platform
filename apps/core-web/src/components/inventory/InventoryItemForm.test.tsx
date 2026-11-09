import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditInventoryItemDialog } from './EditInventoryItemDialog'
import * as inventoryApi from '@/api/inventory'
import { deInventory } from '@/test/de-inventory'

vi.mock('@/api/inventory')
vi.mock('@/components/BrandCombobox', () => ({
  BrandCombobox: () => null,
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('InventoryItemForm', () => {
  const mutateAsync = vi.fn().mockResolvedValue({ id: 'item-1' })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(inventoryApi.useUpdateInventoryItem).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof inventoryApi.useUpdateInventoryItem>)
  })

  afterEach(() => {
    cleanup()
  })

  it('edit form omits revision', async () => {
    render(
      <EditInventoryItemDialog
        open
        onOpenChange={vi.fn()}
        item={{
          id: 'item-1',
          sku: 'SKU-1',
          name: 'Filter',
          brand: 'OEM',
          price: 12.5,
          cost_price: 6,
          status: 'IN_STOCK',
          quantity_available: 3,
          warehouse_location: 'Bin A',
          revision: 42,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: deInventory.actions.saveChanges }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        sku: 'SKU-1',
        name: 'Filter',
        cost_price: 6,
        retail_price: 12.5,
        brandId: undefined,
      })
    })
    expect(mutateAsync.mock.calls[0]?.[0]).not.toHaveProperty('revision')
  })
})
