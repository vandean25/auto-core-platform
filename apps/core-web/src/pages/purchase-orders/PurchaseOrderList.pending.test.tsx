import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deFinance from '../../../../../locales/de/finance.json'
import errorsDe from '../../../../../locales/de/errors.json'
import PurchaseOrderList from './PurchaseOrderList'
import { queuePurchaseOrderCreate } from './usePurchaseOrderPendingCreate'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const http = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response

const confirmed = {
  id: 'po-1',
  vendor_id: 'vendor-1',
  vendor: {
    id: 'vendor-1',
    name: 'Nordteile',
    email: 'nord@example.test',
    account_number: 'K-88',
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
  },
  status: 'DRAFT',
  order_number: 'PO-9',
  items: [],
  createdAt: '2026-11-08T00:00:00.000Z',
}

let orders = [confirmed]
let post: Response | Promise<Response> = http(500, {})

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={['/purchase-orders']}>
            <Routes>
              <Route path="/purchase-orders" element={<PurchaseOrderList />} />
              <Route path="/purchase-orders/:id" element={<p>confirmed-order</p>} />
            </Routes>
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  orders = []
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.startsWith('/api/purchase-orders') && init?.method === 'POST') return post
    if (path.startsWith('/api/purchase-orders')) {
      return http(200, { data: orders, meta: { total: orders.length, page: 1, pageSize: 10, pageCount: 1 } })
    }
    return http(200, [])
  })
})

describe('PurchaseOrderList create behind a pending row (ADR-0036 R1)', () => {
  it('shows the vendor without an order number, then opens the server order once', async () => {
    let release: (response: Response) => void = () => {}
    post = new Promise((resolve) => {
      release = resolve
    })
    queuePurchaseOrderCreate({ vendorId: 'vendor-1', vendorName: 'Nordteile' })
    renderList()

    expect(await screen.findByText('Nordteile', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText('PO-9')).not.toBeInTheDocument()
    expect(screen.queryByText(deFinance.purchaseOrders.list.deleted)).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Nordteile/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('link', { name: 'PO-9' })).not.toBeInTheDocument()

    orders = [confirmed]
    release(http(201, { id: 'po-1' }))

    expect(await screen.findByText('confirmed-order')).toBeInTheDocument()
    expect(screen.getAllByText('confirmed-order')).toHaveLength(1)
  })

  it('keeps the shell on 403 and does not show the server body or open an order', async () => {
    post = http(403, { message: 'Geheim' })
    queuePurchaseOrderCreate({ vendorId: 'vendor-1', vendorName: 'Nordteile' })
    renderList()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(errorsDe.codes.HTTP_403)
    expect(screen.queryByText('Geheim')).not.toBeInTheDocument()
    expect(screen.getByText('Nordteile')).toBeInTheDocument()
    expect(screen.queryByText('confirmed-order')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('PO-9')).not.toBeInTheDocument())
  })
})
