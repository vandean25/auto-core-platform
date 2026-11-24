import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import deEnums from '../../../../../locales/de/enums.json'
import deInventory from '../../../../../locales/de/inventory.json'
import { AdjustInventoryStockDialog } from './AdjustInventoryStockDialog'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdjustInventoryStockDialog itemId="item-1" open={true} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(fetchWithAuth).mockImplementation((input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/locations')) {
      return Promise.resolve(jsonResponse([{ id: 'bin-1', name: 'Fach 1', code: 'F1', type: 'bin' }]))
    }
    if (url.includes('/adjustment-valuation')) {
      return Promise.resolve(
        jsonResponse({ unitCost: '12.3456', valueSource: 'AVG', canOverrideValue: false }),
      )
    }
    if (method === 'POST' && url.endsWith('/adjust')) {
      return Promise.resolve(jsonResponse({}, 204))
    }
    return Promise.resolve(jsonResponse({}))
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AdjustInventoryStockDialog', () => {
  it('shows automatic value preview and hides override when canOverrideValue is false', async () => {
    renderDialog()

    const triggers = screen.getAllByRole('combobox')
    fireEvent.click(triggers[0])
    fireEvent.click(await screen.findByRole('option', { name: 'Fach 1' }))

    await waitFor(() => {
      expect(screen.getByText(/12,3456/)).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('checkbox', { name: deInventory.dialogs.adjustStock.overrideToggle }),
    ).not.toBeInTheDocument()
  })

  it('requires note when reason is OTHER and submits enum + note', async () => {
    const postBodies: unknown[] = []
    vi.mocked(fetchWithAuth).mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/locations')) {
        return Promise.resolve(jsonResponse([{ id: 'bin-1', name: 'Fach 1', code: 'F1', type: 'bin' }]))
      }
      if (url.includes('/adjustment-valuation')) {
        return Promise.resolve(
          jsonResponse({ unitCost: '10.0000', valueSource: 'LAST_EK', canOverrideValue: true }),
        )
      }
      if (method === 'POST' && url.endsWith('/adjust')) {
        postBodies.push(JSON.parse(String(init?.body ?? '{}')))
        return Promise.resolve(jsonResponse({}, 204))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderDialog()

    const triggers = screen.getAllByRole('combobox')
    fireEvent.click(triggers[0])
    fireEvent.click(await screen.findByRole('option', { name: 'Fach 1' }))

    fireEvent.change(screen.getByLabelText(deInventory.dialogs.adjustStock.signedQuantity), {
      target: { value: '2' },
    })

    const reasonTrigger = screen.getAllByRole('combobox')[1]
    fireEvent.click(reasonTrigger)
    fireEvent.click(await screen.findByRole('option', { name: deEnums.stockAdjustmentReason.OTHER }))

    // Submit without note -> must not POST
    fireEvent.click(screen.getByRole('button', { name: deInventory.actions.applyAdjustment }))
    expect(postBodies).toHaveLength(0)

    fireEvent.change(screen.getByLabelText(deInventory.dialogs.adjustStock.note), {
      target: { value: 'Sonderfall' },
    })
    fireEvent.click(screen.getByRole('button', { name: deInventory.actions.applyAdjustment }))

    await waitFor(() => expect(postBodies).toHaveLength(1))
    expect(postBodies[0]).toMatchObject({
      locationId: 'bin-1',
      quantity: 2,
      reason: 'OTHER',
      note: 'Sonderfall',
    })
  })
})
