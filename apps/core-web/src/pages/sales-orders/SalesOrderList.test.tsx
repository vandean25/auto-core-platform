import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deSales from '../../../../../locales/de/sales.json'
import errorsDe from '../../../../../locales/de/errors.json'
import SalesOrderList from './SalesOrderList'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))

const http = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response

const customer = {
  id: 'cust-1',
  type: 'COMPANY' as const,
  company_name: 'Example GmbH',
  first_name: 'Erika',
  last_name: 'Example',
  email: 'contact@example.test',
}

function createOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'so-draft',
    order_number: 'SO-2026-0001',
    status: 'DRAFT',
    customer_id: customer.id,
    customer,
    vehicle: null,
    total_amount: '100.00',
    items: [],
    invoice: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

let orders = [createOrder()]

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={['/sales-orders']}>
            <SalesOrderList />
            <EntityActionConfirmHost />
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  orders = [createOrder()]
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.includes('/api/sales-orders/') && init?.method === 'DELETE') {
      return http(403, { statusCode: 403, message: 'Forbidden resource' })
    }
    if (path.startsWith('/api/sales-orders')) {
      return http(200, {
        data: orders,
        meta: { total: orders.length, page: 1, pageSize: 10, pageCount: 1 },
      })
    }
    return http(404, {})
  })
})

describe('SalesOrderList delete', () => {
  it('delete hidden for non-draft', async () => {
    orders = [createOrder({ id: 'so-confirmed', status: 'CONFIRMED' })]
    renderList()

    await screen.findByText('SO-2026-0001')
    const row = screen.getByRole('row', { name: /SO-2026-0001/i })
    fireEvent.contextMenu(row)
    expect(screen.queryByRole('button', { name: deSales.shared.delete })).not.toBeInTheDocument()
    expect(document.querySelector('[data-action-id="salesOrder.delete"]')).toBeNull()
  })

  it('delete 403 shown', async () => {
    renderList()

    const row = await screen.findByRole('row', { name: /SO-2026-0001/i })
    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByRole('button', { name: deSales.shared.delete }))

    const alert = await screen.findByRole('alertdialog')
    fireEvent.click(within(alert).getByRole('button', { name: deSales.shared.delete }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(errorsDe.codes.HTTP_403))
    expect(screen.getByText('SO-2026-0001')).toBeInTheDocument()
  })
})
