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
  useInventoryHistory: () => ({
    data: [
      {
        id: 'tx-receipt',
        quantity: '4',
        type: 'PURCHASE_RECEIPT',
        reference_id: 'manual-receipt',
        cost_basis: '5.5',
        extended_value: '22',
        createdAt: '2026-11-20T10:00:00.000Z',
        item: { sku: 'DEMO-SKU', name: 'Demo part' },
        location: { name: 'Fach 1' },
      },
      {
        id: 'tx-adj',
        quantity: '-2',
        type: 'ADJUSTMENT',
        reference_id: 'manual-adjustment',
        cost_basis: '5.5',
        extended_value: '-11',
        reason: 'BREAKAGE',
        note: 'Heruntergefallen',
        value_source: 'AVG',
        createdAt: '2026-11-21T10:00:00.000Z',
        item: { sku: 'DEMO-SKU', name: 'Demo part' },
        location: { name: 'Fach 1' },
      },
    ],
    isLoading: false,
  }),
  useReceiveInventoryStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdjustInventoryStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdjustmentValuation: () => ({ data: undefined, isLoading: false }),
  useReverseInventoryTransaction: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

  it('renders ledger table with Kosten, Wert, Grund columns and Gegenbuchung action', () => {
    renderPage()
    const table = screen.getByTestId('inventory-ledger-table')
    expect(table).not.toHaveClass('min-w-[720px]')
    expect(screen.getByRole('columnheader', { name: deInventory.ledger.columns.cost })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: deInventory.ledger.columns.value })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: deInventory.ledger.columns.reason })).toBeInTheDocument()
    expect(screen.getAllByText(/Bruch\/Beschädigung/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Heruntergefallen/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('button', { name: deInventory.ledger.reverseAction }).length).toBeGreaterThanOrEqual(1)
  })
})
