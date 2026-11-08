import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deCommon from '../../../../../locales/de/common.json'
import deFinance from '../../../../../locales/de/finance.json'
import errorsDe from '../../../../../locales/de/errors.json'
import VendorList from './VendorList'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const copy = deFinance.vendors
const http = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response

type VendorRow = {
  id: string
  name: string
  email: string
  account_number: string
  supportedBrands: []
  createdAt: string
  updatedAt: string
}

let vendors: VendorRow[]
let post: Response | Promise<Response>

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={['/vendors']}>
            <VendorList />
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

async function submitVendor() {
  fireEvent.click(await screen.findByRole('button', { name: copy.list.create }))
  fireEvent.change(await screen.findByLabelText(deFinance.columns.name), { target: { value: 'Nordteile' } })
  fireEvent.change(screen.getByLabelText(deFinance.columns.email), { target: { value: 'nord@example.test' } })
  fireEvent.change(screen.getByLabelText(copy.dialog.accountNumber), { target: { value: 'K-88' } })
  fireEvent.click(screen.getByRole('button', { name: copy.dialog.saveVendor }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

beforeEach(() => {
  vendors = []
  post = http(500, {})
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.startsWith('/api/vendors') && init?.method === 'POST') return post
    if (path.startsWith('/api/vendors')) {
      return http(200, { data: vendors, meta: { total: vendors.length, page: 1, pageSize: 10, pageCount: 1 } })
    }
    if (path.startsWith('/api/brands')) {
      return http(200, { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 1 } })
    }
    return http(200, [])
  })
})

describe('VendorList create behind a pending row (ADR-0036 R1)', () => {
  it('shows the entered name without an account number, then one confirmed vendor', async () => {
    let release: (response: Response) => void = () => {}
    post = new Promise((resolve) => {
      release = resolve
    })
    renderList()
    await submitVendor()

    const pending = rows()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toHaveTextContent('Nordteile')
    expect(pending[0]).toHaveTextContent('nord@example.test')
    expect(pending[0]).not.toHaveTextContent('K-88')
    expect(pending[0]).toHaveAttribute('aria-disabled', 'true')
    expect(within(pending[0]).queryByRole('link')).not.toBeInTheDocument()
    expect(within(pending[0]).queryByRole('button')).not.toBeInTheDocument()

    vendors = [{
      id: 'vendor-1',
      name: 'Nordteile',
      email: 'nord@example.test',
      account_number: 'K-88',
      supportedBrands: [],
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z',
    }]
    release(http(201, { id: 'vendor-1' }))

    await waitFor(() => expect(screen.getAllByText('Nordteile')).toHaveLength(1))
    expect(rows()[0]).toHaveTextContent('K-88')
    expect(screen.queryByLabelText(deCommon.dataTable.loading.pendingRow)).not.toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('keeps the shell on 403 and shows the permission text without the server body', async () => {
    post = http(403, { message: 'Geheim' })
    renderList()
    await submitVendor()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(errorsDe.codes.HTTP_403)
    expect(alert).not.toHaveTextContent('Geheim')
    expect(screen.getByText('Nordteile')).toBeInTheDocument()
    expect(screen.queryByText('K-88')).not.toBeInTheDocument()
    expect(vi.mocked(fetchWithAuth).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
})
