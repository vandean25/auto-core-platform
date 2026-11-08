import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deInventory from '../../../../../locales/de/inventory.json'
import errorsDe from '../../../../../locales/de/errors.json'
import StockTransferList from './StockTransferList'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('@/api/inventory', async () => {
  const actual = await vi.importActual<typeof import('@/api/inventory')>('@/api/inventory')
  return {
    ...actual,
    useInventory: () => ({
      data: { data: [{ id: 'item-1', sku: 'OF-1', name: 'Ölfilter' }] },
      isFetching: false,
    }),
  }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const copy = deInventory.stockTransfers
const http = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response

const sites = [
  { id: 'site-w', code: 'W', name: 'Wien', legalEntityId: 'le-1', legalEntityName: 'Werk' },
  { id: 'site-g', code: 'G', name: 'Graz', legalEntityId: 'le-1', legalEntityName: 'Werk' },
]

const part = {
  id: 'item-1',
  sku: 'OF-1',
  name: 'Ölfilter',
  brand: '',
  price: 19.5,
  status: 'IN_STOCK',
  quantity_available: 4,
  warehouse_location: '',
}

const confirmed = {
  id: 'transfer-1',
  transferNumber: 'TR-9',
  fromSiteId: 'site-w',
  fromSiteName: 'Wien',
  toSiteId: 'site-g',
  toSiteName: 'Graz',
  status: 'REQUESTED',
  version: 1,
  requestedByUserId: 'user-1',
  approvedByUserId: null,
  shippedByUserId: null,
  receivedByUserId: null,
  rejectReason: null,
  cancelReason: null,
  createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z',
  lines: [{ id: 'line-1', requestedQty: 2 }],
}

let transfers: unknown[] = []
let post: Response | Promise<Response> = http(500, {})

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SavedViewsProvider userKey="test-user">
      <MemoryRouter initialEntries={['/stock-transfers']}>
        <Routes>
          <Route path="/stock-transfers" element={<StockTransferList />} />
          <Route path="/stock-transfers/:id" element={<p>confirmed-transfer</p>} />
        </Routes>
      </MemoryRouter>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

async function submitTransfer() {
  fireEvent.click(await screen.findByRole('button', { name: copy.list.newTransfer }))
  fireEvent.click(await screen.findByLabelText(copy.create.fromSite))
  fireEvent.click(await screen.findByRole('option', { name: 'Wien (W)' }))
  fireEvent.click(screen.getByLabelText(copy.create.toSite))
  fireEvent.click(await screen.findByRole('option', { name: 'Graz (G)' }))
  fireEvent.change(screen.getByLabelText(copy.create.addParts), { target: { value: 'OF' } })
  const partButton = await screen.findByRole('button', { name: /OF-1/, hidden: true })
  fireEvent.click(partButton)
  fireEvent.click(screen.getByRole('button', { name: deInventory.actions.submitRequest }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

beforeEach(() => {
  transfers = []
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    const path = String(url)
    if (path === '/api/sites') return http(200, sites)
    if (path === '/api/me/sites') return http(200, [])
    if (path.startsWith('/api/inventory')) {
      return http(200, { data: [part], meta: { total: 1, page: 1, pageSize: 8, pageCount: 1 } })
    }
    if (path.startsWith('/api/stock-transfers') && init?.method === 'POST') return post
    if (path.startsWith('/api/stock-transfers')) return http(200, transfers)
    return http(200, [])
  })
})

describe('StockTransferList create behind a pending row (ADR-0036 R1)', () => {
  it('shows the sites without a number or quantity, then opens the server transfer once', async () => {
    let release: (response: Response) => void = () => {}
    post = new Promise((resolve) => {
      release = resolve
    })
    renderList()
    await submitTransfer()

    const pending = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toHaveTextContent('Wien')
    expect(pending[0]).toHaveTextContent('Graz')
    expect(pending[0]).not.toHaveTextContent('TR-9')
    expect(pending[0]).not.toHaveTextContent('2')
    expect(pending[0]).toHaveAttribute('aria-disabled', 'true')
    expect(within(pending[0]).queryByRole('link')).not.toBeInTheDocument()

    transfers = [confirmed]
    release(http(201, confirmed))
    expect(await screen.findByText('confirmed-transfer')).toBeInTheDocument()
    expect(screen.getAllByText('confirmed-transfer')).toHaveLength(1)
  })

  it('keeps the shell on 403 and shows the permission text without the server body', async () => {
    post = http(403, { message: 'Geheim' })
    renderList()
    await submitTransfer()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(errorsDe.codes.HTTP_403)
    expect(screen.queryByText('Geheim')).not.toBeInTheDocument()
    expect(screen.getByText('Wien')).toBeInTheDocument()
    expect(screen.queryByText('confirmed-transfer')).not.toBeInTheDocument()
    expect(screen.queryByText('TR-9')).not.toBeInTheDocument()
  })
})
