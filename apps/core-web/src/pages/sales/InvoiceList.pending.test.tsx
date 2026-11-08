import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import errorsDe from '../../../../../locales/de/errors.json'
import { deSales } from '@/test/de-sales'
import InvoiceListPage from './InvoiceListPage'
import { queueInvoiceDraftCreate } from './useInvoicePendingCreate'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ claims: { role: 'ADMIN' } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const http = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response

const confirmed = {
  id: 'inv-9',
  status: 'DRAFT',
  invoice_number: null as string | null,
  customer_id: 'cust-1',
  customer: { id: 'cust-1', type: 'PRIVATE', first_name: 'Test', last_name: 'Customer' },
  date: '2026-11-08T00:00:00.000Z',
  due_date: '2026-11-22T00:00:00.000Z',
  total_net: '10',
  total_tax: '2',
  total_gross: '12',
  items: [],
  sales_order_id: 'so-1',
}

let invoices = [] as Array<typeof confirmed>
let post: Response | Promise<Response> = http(500, {})
let posts: string[] = []
let listGate: Promise<Response> | null = null

const activatedSkeleton = () => document.querySelector('tbody .animate-pulse')

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SavedViewsProvider userKey="test-user">
        <MemoryRouter initialEntries={['/sales/invoices?sortField=status']}>
          <Routes>
            <Route path="/sales/invoices" element={<InvoiceListPage />} />
            <Route path="/sales/invoices/:id/edit" element={<p>draft-editor</p>} />
          </Routes>
        </MemoryRouter>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  invoices = []
  posts = []
  listGate = null
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    const path = String(url)
    if (path === '/api/sales-orders/so-1/create-invoice' && init?.method === 'POST') {
      posts.push(path)
      return post
    }
    if (path.startsWith('/api/sales/invoices')) return listGate ?? http(200, invoices)
    return http(200, { data: [], meta: { total: 0, page: 1, pageSize: 10, pageCount: 1 } })
  })
})

describe('InvoiceList pending draft (ADR-0036 R1)', () => {
  it('shows the customer without a number or a price, then opens the editor once', async () => {
    let release: (response: Response) => void = () => {}
    post = new Promise((resolve) => {
      release = resolve
    })
    queueInvoiceDraftCreate({ orderId: 'so-1', customerName: 'Test Customer' })
    renderList()

    expect(await screen.findByText('Test Customer')).toBeInTheDocument()
    expect(screen.queryByText('RE-9')).not.toBeInTheDocument()
    expect(screen.queryByText(/0,00/)).not.toBeInTheDocument()
    expect(screen.queryByText('12,00')).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Test Customer/ })).toHaveAttribute('aria-disabled', 'true')
    expect(within(screen.getByRole('row', { name: /Test Customer/ })).queryByRole('button')).not.toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Test Customer/ })).queryByRole('link')).not.toBeInTheDocument()

    invoices = [{ ...confirmed, invoice_number: 'RE-9' }]
    release(http(201, { id: 'inv-9' }))

    expect(await screen.findByText('draft-editor')).toBeInTheDocument()
    expect(screen.getAllByText('draft-editor')).toHaveLength(1)
    expect(posts).toHaveLength(1)
  })

  it('keeps the row on 403 and shows the permission error, not the server body', async () => {
    post = http(403, { message: 'Geheim' })
    queueInvoiceDraftCreate({ orderId: 'so-1', customerName: 'Test Customer' })
    renderList()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(errorsDe.codes.HTTP_403)
    expect(screen.queryByText('Geheim')).not.toBeInTheDocument()
    expect(screen.getByText('Test Customer')).toBeInTheDocument()
    expect(screen.queryByText('draft-editor')).not.toBeInTheDocument()
  })

  it('keeps the pending row visible when the first-load skeleton is already held', async () => {
    let releaseList!: (value: Response) => void
    vi.useFakeTimers()
    try {
      listGate = new Promise((done) => {
        releaseList = done
      })
      post = new Promise(() => {})
      renderList()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(INTERACTION_LOADING_TIMINGS.skeletonDelayMs)
      })
      expect(activatedSkeleton()).not.toBeNull()
      queueInvoiceDraftCreate({ orderId: 'so-1', customerName: 'Test Customer' })
      fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: deSales.invoices.list.columns.status }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(screen.getByText('Test Customer')).toBeInTheDocument()
      expect(activatedSkeleton()).toBeNull()
      expect(posts).toHaveLength(1)
      releaseList(http(200, []))
    } finally {
      vi.useRealTimers()
    }
  })

  it('posts once when the same order is queued twice', async () => {
    post = new Promise(() => {})
    queueInvoiceDraftCreate({ orderId: 'so-1', customerName: 'Test Customer' })
    queueInvoiceDraftCreate({ orderId: 'so-1', customerName: 'Test Customer' })
    renderList()

    expect(await screen.findByText('Test Customer')).toBeInTheDocument()
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(screen.getAllByText('Test Customer')).toHaveLength(1)
  })
})
