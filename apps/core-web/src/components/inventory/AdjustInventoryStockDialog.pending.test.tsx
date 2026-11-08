import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { inventoryKeys, useInventoryItem } from '@/api/inventory'
import { useShipStockTransfer, stockTransferKeys } from '@/api/stock-transfers'
import { SubmitButtonPending } from '@/components/data-table/data-table-states'
import deInventory from '../../../../../locales/de/inventory.json'
import { AdjustInventoryStockDialog } from './AdjustInventoryStockDialog'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))

const item = {
  id: 'item-1',
  sku: 'OF-1',
  name: 'Ölfilter',
  brand: 'Bosch',
  price: 12.5,
  status: 'IN_STOCK' as const,
  quantity_available: 4,
  cost_price: 8,
  warehouse_location: 'A-1',
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

function Harness() {
  const detail = useInventoryItem('item-1')
  const ship = useShipStockTransfer('transfer-1')
  const [open, setOpen] = useState(true)
  return (
    <>
      <output data-testid="on-hand">{detail.data?.quantity_available ?? ''}</output>
      <output data-testid="transfer-status">{ship.data ? 'loaded' : 'idle'}</output>
      <AdjustInventoryStockDialog itemId="item-1" open={open} onOpenChange={setOpen} />
      <SubmitButtonPending
        pending={ship.isPending}
        label={deInventory.actions.ship}
        onClick={() => void ship.mutateAsync({ expectedVersion: 1, lines: [] })}
      />
    </>
  )
}

beforeEach(() => {
  vi.mocked(fetchWithAuth).mockImplementation((input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'POST' && url.endsWith('/adjust')) return new Promise<Response>(() => undefined)
    if (method === 'POST' && url.includes('/ship')) return new Promise<Response>(() => undefined)
    if (url.includes('/locations')) {
      return Promise.resolve(jsonResponse([{ id: 'bin-1', name: 'Fach 1', code: 'F1', type: 'bin' }]))
    }
    if (url.includes('/stock-transfers/transfer-1')) {
      return Promise.resolve(jsonResponse({ id: 'transfer-1', status: 'APPROVED', version: 1, lines: [] }))
    }
    return Promise.resolve(jsonResponse(item))
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('server-confirmed stock and transfers (ADR-0036 R1)', () => {
  // Scenario 4: a stock quantity change shows pending on the button and does not invent a new on-hand quantity.
  it('shows pending on the adjustment button and keeps the previous quantity until the server answers', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    client.setQueryData(inventoryKeys.detail('item-1'), item)
    client.setQueryData(stockTransferKeys.detail('transfer-1'), { id: 'transfer-1', status: 'APPROVED', version: 1 })
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('on-hand')).toHaveTextContent('4')
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Fach 1' }))
    fireEvent.change(screen.getByLabelText(deInventory.dialogs.adjustStock.signedQuantity), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText(deInventory.dialogs.adjustStock.reason), { target: { value: 'Zählung' } })
    fireEvent.click(screen.getByRole('button', { name: deInventory.actions.applyAdjustment }))

    const apply = await screen.findByRole('button', { name: deInventory.actions.applyAdjustment })
    await waitFor(() => expect(apply).toHaveAttribute('aria-busy', 'true'))
    expect(apply).toBeDisabled()
    expect(screen.getByTestId('on-hand')).toHaveTextContent('4')
    expect(client.getQueryData<typeof item>(inventoryKeys.detail('item-1'))?.quantity_available).toBe(4)

    const ship = screen.getByRole('button', { name: deInventory.actions.ship, hidden: true })
    fireEvent.click(ship)
    await waitFor(() => expect(ship).toHaveAttribute('aria-busy', 'true'))
    expect(client.getQueryData<{ status: string }>(stockTransferKeys.detail('transfer-1'))?.status).toBe('APPROVED')
  })
})
