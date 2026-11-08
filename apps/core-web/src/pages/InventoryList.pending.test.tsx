import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deCommon from '../../../../locales/de/common.json'
import deInventory from '../../../../locales/de/inventory.json'
import InventoryList from './InventoryList'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ claims: { role: 'ADMIN' } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const dialogCopy = deInventory.addItemDialog
const loading = deCommon.dataTable.loading

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const httpResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

const serverItem = {
  id: 'srv-1',
  sku: 'OF-9',
  name: 'Ölfilter',
  brand: 'Bosch',
  price: 19.5,
  status: 'IN_STOCK',
  quantity_available: 3,
  warehouse_location: 'A-1',
}

let postGate: Deferred<Response> | null
let listGate: Promise<Response> | null
let items: Array<typeof serverItem>

const activatedSkeleton = () => document.querySelector('tbody .animate-pulse')

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={['/inventory?sortField=status']}>
            <InventoryList />
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

beforeEach(() => {
  postGate = null
  listGate = null
  items = []
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.startsWith('/api/brands')) {
      return httpResponse(200, { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 1 } })
    }
    if (path.startsWith('/api/inventory/locations')) return httpResponse(200, [])
    if (init?.method === 'POST' && path === '/api/inventory') {
      return postGate ? postGate.promise : httpResponse(201, serverItem)
    }
    if (path.startsWith('/api/inventory')) {
      if (listGate) {
        const gate = listGate
        listGate = null
        return gate
      }
      return httpResponse(200, {
        data: items,
        meta: { total: items.length, page: 1, pageSize: 10, pageCount: 1 },
      })
    }
    return httpResponse(200, { data: [] })
  })
})

afterEach(() => {
  cleanup()
  vi.mocked(fetchWithAuth).mockReset()
})

describe('InventoryList create behind a pending row (ADR-0036 R1)', () => {
  // Scenario 5: a pending row has no article number, price or actions, and the server row replaces it once.
  it('shows a pending row without number, price or actions, then swaps in the server row once', async () => {
    vi.useFakeTimers()
    let releaseList!: (value: Response) => void
    try {
      listGate = new Promise((done) => { releaseList = done })
      postGate = deferred<Response>()
      renderList()
      fireEvent.click(screen.getByRole('button', { name: dialogCopy.trigger }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      fireEvent.change(screen.getByLabelText(dialogCopy.sku), { target: { value: 'OF-9' } })
      fireEvent.change(screen.getByLabelText(dialogCopy.name), { target: { value: 'Ölfilter' } })
      fireEvent.change(screen.getByLabelText(dialogCopy.costPrice), { target: { value: '8.5' } })
      fireEvent.change(screen.getByLabelText(dialogCopy.retailPrice), { target: { value: '19.5' } })
      await act(async () => { await vi.advanceTimersByTimeAsync(INTERACTION_LOADING_TIMINGS.skeletonDelayMs) })
      expect(activatedSkeleton()).not.toBeNull()

      fireEvent.click(screen.getByRole('button', { name: dialogCopy.submit }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })

      const [pending] = bodyRows()
      expect(activatedSkeleton()).toBeNull()
      expect(screen.getAllByText(loading.pendingRow)).toHaveLength(1)
      expect(pending).toHaveTextContent('Ölfilter')
      expect(pending).not.toHaveTextContent('OF-9')
      expect(pending).not.toHaveTextContent('19,50')
      expect(pending).not.toHaveTextContent('8,50')
      expect(pending).toHaveAttribute('aria-disabled', 'true')
      expect(within(pending!).queryAllByRole('button')).toHaveLength(0)
      expect(within(pending!).queryAllByRole('link')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }

    releaseList(httpResponse(200, { data: [], meta: { total: 0, page: 1, pageSize: 10, pageCount: 1 } }))
    items = [serverItem]
    await act(async () => postGate?.resolve(httpResponse(201, serverItem)))

    await waitFor(() => expect(screen.queryAllByText(loading.pendingRow)).toHaveLength(0))
    const rows = bodyRows().filter((row) => row.textContent?.includes('Ölfilter'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('OF-9')
    expect(rows[0]).toHaveTextContent('19,50')
    expect(toast.success).toHaveBeenCalledTimes(1)
  })
})
