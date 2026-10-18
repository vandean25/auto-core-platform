import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import deInventory from '../../../../../locales/de/inventory.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import InventoryLedgerPage from './InventoryLedgerPage'

registerGermanUiForTests()

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({
    data: { activeRole: 'ADMIN' },
  }),
}))

vi.mock('@/api/inventory', () => ({
  useInventoryItem: () => ({
    data: {
      id: 'item-1',
      sku: 'DEMO-SKU',
      name: 'Demo part',
      brand: 'Demo brand',
      price: 12,
      cost_price: 5,
      status: 'OUT_OF_STOCK',
      quantity_available: 0,
      warehouse_location: 'N/A',
    },
    isLoading: false,
  }),
  useInventoryItemBySku: () => ({ data: null, isLoading: false }),
  useInventoryHistory: () => ({ data: [], isLoading: false }),
  useReceiveInventoryStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdjustInventoryStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateInventoryItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/api/locations', () => ({
  useLocations: () => ({ data: [] }),
}))

function renderPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/inventory/item-1/ledger?sku=DEMO-SKU']}>
        <Routes>
          <Route path="/inventory/:itemId/ledger" element={<InventoryLedgerPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('InventoryLedgerPage', () => {
  it('shows Receive, Adjust, and Edit for admins', () => {
    renderPage()
    expect(screen.getByRole('button', { name: deInventory.actions.receive })).toBeVisible()
    expect(screen.getByRole('button', { name: deInventory.actions.adjust })).toBeVisible()
    expect(screen.getByRole('button', { name: deInventory.actions.edit })).toBeEnabled()
  })
})
