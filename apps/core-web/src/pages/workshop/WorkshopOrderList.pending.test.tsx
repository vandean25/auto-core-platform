import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { workshopKeys } from '@/api/workshop'
import { mockListLayout, settleVirtualizerTimers } from '@/components/data-table/data-table-infinite-test-utils'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { deWorkshop } from '@/test/de-workshop'
import deCommon from '../../../../../locales/de/common.json'
import deErrors from '../../../../../locales/de/errors.json'
import WorkshopOrderList from './WorkshopOrderList'

// Only the network boundary is faked. The real list, intake dialog, create mutation and orders query run together.
vi.mock('@/api/client', () => ({
  API_BASE_URL: 'http://127.0.0.1:3000',
  fetchWithAuth: vi.fn(),
}))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))

const oi = deWorkshop.orderIntake
const loading = deCommon.dataTable.loading

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const vehicle = {
  id: 'vehicle-1',
  make: 'Volkswagen',
  model: 'Golf VII',
  year: 2018,
  plate: 'W-12345AB',
  customer: { id: 'customer-1', first_name: 'Pilot', last_name: 'Customer', type: 'PRIVATE' },
}

function serverOrder(id: string, orderNumber: string) {
  return {
    id,
    order_number: orderNumber,
    createdAt: '2026-11-06T08:00:00.000Z',
    status: 'SCHEDULED',
    vehicle,
    customer: vehicle.customer,
    tasks: [],
  }
}

const httpResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

type FakeServer = {
  orders: ReturnType<typeof serverOrder>[]
  orderListGets: number
  postBodies: Record<string, unknown>[]
  /** Settles the next POST. Left null, the POST answers with the next entry of `postResults`. */
  postGate: Deferred<Response> | null
  postResults: Response[]
  /** Holds the next orders GET until released. */
  listGate: Deferred<void> | null
  /** Makes the next orders GET answer 500. */
  failNextList: boolean
}

let server: FakeServer
let queryClient: QueryClient

function installFakeServer() {
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    const target = String(url)
    if (target.startsWith('/api/workshop/search')) {
      return httpResponse(200, { data: { vehicles: [vehicle], customers: [] } })
    }
    if (target.startsWith('/api/workshop/orders/capped-count')) {
      return httpResponse(200, { count: server.orders.length, isCapped: false })
    }
    if (target.startsWith('/api/workshop/orders')) {
      if (init?.method === 'POST') {
        server.postBodies.push(JSON.parse(String(init.body)))
        return server.postGate ? server.postGate.promise : (server.postResults.shift() as Response)
      }
      server.orderListGets += 1
      const gate = server.listGate
      server.listGate = null
      if (gate) await gate.promise
      if (server.failNextList) {
        server.failNextList = false
        return httpResponse(500, {})
      }
      const total = server.orders.length
      return httpResponse(200, { data: server.orders, meta: { page: 1, pageSize: 10, total, pageCount: 1 } })
    }
    return httpResponse(200, { data: [] })
  })
}

/** The order-number sort keeps the paged offset list, whose refetch lifecycle these tests cover (AUT-956). */
const OFFSET_LIST = '/workshop/orders?sortField=orderNo&sortDirection=asc'

function renderList(initialEntry = OFFSET_LIST) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/workshop/orders" element={<WorkshopOrderList />} />
              <Route path="/workshop/orders/:id" element={<h1>Order detail route</h1>} />
            </Routes>
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

/** Opens the real intake dialog, picks the vehicle and submits. */
async function submitIntake() {
  fireEvent.click(await screen.findByRole('button', { name: deWorkshop.orders.list.newOrder }))
  fireEvent.change(await screen.findByPlaceholderText(oi.searchPlaceholder), { target: { value: 'W-12345' } })
  fireEvent.click(await screen.findByRole('button', { name: /2018 Volkswagen Golf VII/i }))
  fireEvent.click(screen.getByRole('button', { name: oi.createOrder }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

const pendingRows = () => screen.queryAllByText(loading.pendingRow)
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const settle = () => act(() => new Promise((done) => setTimeout(done, 30)))

beforeEach(() => {
  server = { orders: [], orderListGets: 0, postBodies: [], postGate: null, postResults: [], listGate: null, failNextList: false }
  installFakeServer()
})

afterEach(() => {
  cleanup()
  vi.mocked(fetchWithAuth).mockReset()
})

describe('WorkshopOrderList list-create lifecycle', () => {
  // Regression: the settle callback captured dataUpdatedAt from the submit click, so any refetch that landed
  // during the POST dropped the pending row before the new order existed in the list.
  it('keeps the pending row through an unrelated refetch and one create refetch, then swaps in the server row', async () => {
    renderList()
    await screen.findByText(deWorkshop.orders.list.empty)
    expect(server.orderListGets).toBe(1)

    server.postGate = deferred<Response>()
    await submitIntake()
    expect(pendingRows()).toHaveLength(1)
    expect(server.postBodies).toEqual([expect.objectContaining({ customerId: 'customer-1', vehicleId: 'vehicle-1' })])

    await act(() => queryClient.refetchQueries({ queryKey: workshopKeys.orders() }))
    expect(server.orderListGets).toBe(2)
    expect(pendingRows()).toHaveLength(1)

    server.orders = [serverOrder('order-new', 'WO-2026-0100')]
    server.listGate = deferred<void>()
    const releaseList = server.listGate
    server.postGate.resolve(httpResponse(201, serverOrder('order-new', 'WO-2026-0100')))

    await waitFor(() => expect(server.orderListGets).toBe(3))
    expect(pendingRows()).toHaveLength(1)
    expect(screen.queryByText('WO-2026-0100')).not.toBeInTheDocument()

    releaseList.resolve()
    expect(await screen.findByText('WO-2026-0100')).toBeInTheDocument()
    expect(pendingRows()).toHaveLength(0)
    expect(bodyRows()).toHaveLength(1)
    await settle()
    expect(server.orderListGets).toBe(3)
  })

  // A new order that sorts onto another page never shows up in the refetch, so the row must clear on the refetch itself.
  it('drops the settled pending row when the create refetch does not contain the new order', async () => {
    server.orders = [serverOrder('order-old', 'WO-2026-0001')]
    renderList()
    await screen.findByText('WO-2026-0001')

    server.postGate = deferred<Response>()
    await submitIntake()
    expect(pendingRows()).toHaveLength(1)

    server.listGate = deferred<void>()
    const releaseList = server.listGate
    server.postGate.resolve(httpResponse(201, serverOrder('order-new', 'WO-2026-0100')))
    await waitFor(() => expect(server.orderListGets).toBe(2))
    expect(pendingRows()).toHaveLength(1)

    releaseList.resolve()
    await waitFor(() => expect(pendingRows()).toHaveLength(0))
    expect(bodyRows()).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Order detail route' })).not.toBeInTheDocument()
  })

  // Regression: Retry only reopened an empty intake dialog and left the failed row behind.
  it('retries the failed submission with the same payload on the same row', async () => {
    server.postResults = [
      httpResponse(500, {}),
      httpResponse(201, serverOrder('order-new', 'WO-2026-0100')),
    ]
    renderList()
    await screen.findByText(deWorkshop.orders.list.empty)

    await submitIntake()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(deErrors.codes.HTTP_500)
    expect(pendingRows()).toHaveLength(1)

    server.orders = [serverOrder('order-new', 'WO-2026-0100')]
    fireEvent.click(within(alert).getByRole('button', { name: loading.retry }))

    expect(await screen.findByText('WO-2026-0100')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.postBodies).toHaveLength(2)
    expect(server.postBodies[1]).toEqual(server.postBodies[0])
    expect(pendingRows()).toHaveLength(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(bodyRows()).toHaveLength(1)
  })

  it('shows a single pending row while the retry is in flight', async () => {
    server.postResults = [httpResponse(500, {})]
    renderList()
    await screen.findByText(deWorkshop.orders.list.empty)
    await submitIntake()
    const alert = await screen.findByRole('alert')

    server.postGate = deferred<Response>()
    fireEvent.click(within(alert).getByRole('button', { name: loading.retry }))

    await waitFor(() => expect(server.postBodies).toHaveLength(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(pendingRows()).toHaveLength(1)
    expect(bodyRows()).toHaveLength(1)
  })

  it('keeps the error marker and re-offers Retry when the retry fails again', async () => {
    server.postResults = [httpResponse(500, {}), httpResponse(503, {})]
    renderList()
    await screen.findByText(deWorkshop.orders.list.empty)
    await submitIntake()
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: loading.retry }))

    expect(await screen.findByText(deErrors.codes.HTTP_503)).toBeInTheDocument()
    expect(pendingRows()).toHaveLength(1)
    expect(screen.getByRole('button', { name: loading.retry })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: loading.dismiss }))
    expect(pendingRows()).toHaveLength(0)
  })

  // Regression: closing the dialog on submit turned the VEHICLE_HAS_ACTIVE_ORDER 409 into plain text without the link.
  it('offers the existing order from the pending row when the vehicle already has an active order', async () => {
    server.postResults = [
      httpResponse(409, {
        message: 'Vehicle already has active order WO-2026-0007',
        code: 'VEHICLE_HAS_ACTIVE_ORDER',
        orderId: 'order-live',
        orderNumber: 'WO-2026-0007',
      }),
    ]
    renderList()
    await screen.findByText(deWorkshop.orders.list.empty)
    await submitIntake()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(oi.activeOrderConflict.replace('{{orderNumber}}', 'WO-2026-0007'))
    expect(within(alert).queryByRole('button', { name: loading.retry })).not.toBeInTheDocument()
    const open = within(alert).getByRole('button', { name: oi.openOrderNumber.replace('{{orderNumber}}', 'WO-2026-0007') })
    expect(open).toHaveClass('min-h-11')

    fireEvent.click(open)
    expect(await screen.findByRole('heading', { name: 'Order detail route' })).toBeInTheDocument()
  })
})

describe('WorkshopOrderList pending row shortcuts', () => {
  // Regression: row shortcuts looked the focused row up among the pending rows too, so "o" on a failed row's
  // controls opened /workshop/orders/<client-generated id>, an order that does not exist.
  it.each([
    ['a failed create with Retry', httpResponse(500, {}), loading.retry],
    [
      'a 409 with Open order',
      httpResponse(409, {
        message: 'Vehicle already has active order WO-2026-0007',
        code: 'VEHICLE_HAS_ACTIVE_ORDER',
        orderId: 'order-live',
        orderNumber: 'WO-2026-0007',
      }),
      oi.openOrderNumber.replace('{{orderNumber}}', 'WO-2026-0007'),
    ],
  ])('does not run the open-order shortcut from the controls of %s', async (_label, failure, buttonName) => {
    server.postResults = [failure]
    renderList()
    await screen.findByText(deWorkshop.orders.list.empty)
    await submitIntake()
    const control = within(await screen.findByRole('alert')).getByRole('button', { name: buttonName })

    act(() => control.focus())
    fireEvent.keyDown(control, { key: 'o', code: 'KeyO' })
    await settle()

    expect(screen.queryByRole('heading', { name: 'Order detail route' })).not.toBeInTheDocument()
  })
})

describe('WorkshopOrderList pending row pointer and keyboard paths', () => {
  const conflict = httpResponse(409, {
    message: 'Vehicle already has active order WO-2026-0007',
    code: 'VEHICLE_HAS_ACTIVE_ORDER',
    orderId: 'order-live',
    orderNumber: 'WO-2026-0007',
  })
  // Regression: a desktop pending row kept onRowClick/onRowPrefetch wired, so clicking or hovering it opened the peek
  // sheet and fetched /workshop/orders/<client-generated id>, an order that does not exist.
  it.each([
    ['in flight', () => { server.postGate = deferred<Response>() }],
    ['failed', () => { server.postResults = [httpResponse(500, {})] }],
    ['a 409', () => { server.postResults = [conflict] }],
  ])('treats the pending row as inert while %s', async (_state, arrange) => {
    arrange()
    renderList()
    await screen.findByText(deWorkshop.orders.list.empty)
    await submitIntake()
    const cell = screen.getByText('2018 Volkswagen Golf VII').closest('td') as HTMLElement
    const row = cell.closest('tr') as HTMLElement
    expect(row).not.toHaveClass('cursor-pointer')

    fireEvent.pointerEnter(row, { pointerType: 'mouse' })
    fireEvent.pointerDown(cell, { pointerType: 'mouse' })
    fireEvent.click(cell)
    fireEvent.click(row)
    act(() => row.focus())
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: 'ContextMenu' })
    await act(() => new Promise((done) => setTimeout(done, 300)))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: deCommon.dataTable.closeContextMenu })).not.toBeInTheDocument()
    const detailGets = vi.mocked(fetchWithAuth).mock.calls.filter(([url]) => /^\/api\/workshop\/orders\/[^/?]+$/.test(String(url)))
    expect(detailGets).toEqual([])
  })
})

describe('WorkshopOrderList filter change', () => {
  const changeSearch = async () => {
    fireEvent.change(await screen.findByPlaceholderText(deWorkshop.orders.list.searchPlaceholder), { target: { value: 'Golf' } })
  }

  // Regression guard for scenarios 3 and 4 through the real orders query: dropping keepPreviousData loses the stale
  // preview (busy table, status text) even though the retained rows still show.
  it('keeps the previous page busy and locked while a filter change loads, then swaps in the new page', async () => {
    server.orders = [serverOrder('order-old', 'WO-2026-0001')]
    renderList()
    await screen.findByText('WO-2026-0001')

    server.orders = [serverOrder('order-new', 'WO-2026-0002')]
    server.listGate = deferred<void>()
    const release = server.listGate
    await changeSearch()

    await waitFor(() => expect(server.orderListGets).toBe(2))
    expect(await screen.findByText(loading.stalePreview)).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('WO-2026-0001')).toBeInTheDocument()

    release.resolve()
    expect(await screen.findByText('WO-2026-0002')).toBeInTheDocument()
    expect(screen.queryByText('WO-2026-0001')).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false')
    expect(screen.queryByText(loading.stalePreview)).not.toBeInTheDocument()
  })

  it('keeps the last page and offers Retry when the filter change fails, then recovers', async () => {
    server.orders = [serverOrder('order-old', 'WO-2026-0001')]
    renderList()
    await screen.findByText('WO-2026-0001')

    server.failNextList = true
    await changeSearch()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(loading.loadFailed)
    expect(screen.getByText('WO-2026-0001')).toBeInTheDocument()

    server.orders = [serverOrder('order-new', 'WO-2026-0002')]
    fireEvent.click(within(alert).getByRole('button', { name: loading.retry }))
    expect(await screen.findByText('WO-2026-0002')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('WorkshopOrderList first load', () => {
  // The skeleton gate must stay silent for a fast response: no skeleton node may ever be added, and the rows
  // show the moment the data lands instead of waiting on the gate.
  it('never mounts a skeleton and shows the rows at once when the first page arrives within 200 ms', async () => {
    server.orders = [serverOrder('order-old', 'WO-2026-0001')]
    server.listGate = deferred<void>()
    const release = server.listGate
    let skeletonSeen = false
    const observer = new MutationObserver(() => {
      if (document.querySelector('.animate-pulse')) skeletonSeen = true
    })
    observer.observe(document.body, { childList: true, subtree: true })

    renderList()
    await act(() => new Promise((done) => setTimeout(done, 100)))
    release.resolve()

    expect(await screen.findByText('WO-2026-0001')).toBeInTheDocument()
    await act(() => new Promise((done) => setTimeout(done, 500)))
    observer.disconnect()
    expect(skeletonSeen).toBe(false)
    expect(screen.getByText('WO-2026-0001')).toBeInTheDocument()
  })
})

describe('WorkshopOrderList infinite mode create (AUT-956)', () => {
  let restoreLayout: () => void
  beforeEach(() => {
    restoreLayout = mockListLayout()
  })
  afterEach(() => restoreLayout())
  afterAll(settleVirtualizerTimers)

  // Regression: the infinite list never refetches after a create, so the settled row kept its pending marker for good.
  it('drops the settled pending row and offers "Liste aktualisieren" without refetching the list', async () => {
    server.orders = [serverOrder('order-old', 'WO-2026-0001')]
    renderList('/workshop/orders')
    expect(await screen.findByText('WO-2026-0001')).toBeInTheDocument()
    const listGets = server.orderListGets

    server.postGate = deferred<Response>()
    await submitIntake()
    expect(pendingRows()).toHaveLength(1)

    server.postGate.resolve(httpResponse(201, serverOrder('order-new', 'WO-2026-0100')))
    await waitFor(() => expect(pendingRows()).toHaveLength(0))
    expect(await screen.findByRole('button', { name: deCommon.dataTable.refreshList })).toBeInTheDocument()
    expect(server.orderListGets).toBe(listGets)
  })
})
