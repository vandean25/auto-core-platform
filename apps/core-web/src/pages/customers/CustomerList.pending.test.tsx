import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { deCustomers } from '@/test/de-customers'
import deCommon from '../../../../../locales/de/common.json'
import errorsDe from '../../../../../locales/de/errors.json'
import CustomerList from './CustomerList'

// Only the network boundary is faked. The real list, create dialog, create mutation and customers query run together.
vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ claims: { role: 'ADMIN' } }) }))

const loading = deCommon.dataTable.loading

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const httpResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

const serverCustomer = (id: string, first: string, last: string) => ({
  id,
  type: 'PRIVATE',
  first_name: first,
  last_name: last,
  company_name: null,
  email: null,
  phone: null,
  address_city: 'Wien',
  address_country: 'AT',
})

type FakeServer = { customers: ReturnType<typeof serverCustomer>[]; gets: number; posts: Record<string, unknown>[]; postGate: Deferred<Response> | null }
let server: FakeServer

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={['/customers']}>
            <Routes>
              <Route path="/customers" element={<CustomerList />} />
            </Routes>
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

/** Opens the real create dialog, fills the names and submits once. */
async function submitCustomer(clicks = 1) {
  fireEvent.click(await screen.findByRole('button', { name: deCustomers.list.addCustomer }))
  fireEvent.change(await screen.findByLabelText(deCustomers.dialog.firstName), { target: { value: 'Pia' } })
  fireEvent.change(screen.getByLabelText(deCustomers.dialog.lastName), { target: { value: 'Pilot' } })
  const submit = screen.getByRole('button', { name: deCustomers.dialog.createCustomer })
  for (let i = 0; i < clicks; i += 1) fireEvent.click(submit)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

const pendingRows = () => screen.queryAllByText(loading.pendingRow)
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const settle = () => act(() => new Promise((done) => setTimeout(done, 30)))

beforeEach(() => {
  server = { customers: [], gets: 0, posts: [], postGate: null }
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    if (String(url).startsWith('/api/customers')) {
      if (init?.method === 'POST') {
        server.posts.push(JSON.parse(String(init.body)))
        return server.postGate ? server.postGate.promise : httpResponse(201, serverCustomer('srv-1', 'Pia', 'Pilot'))
      }
      server.gets += 1
      return httpResponse(200, {
        data: server.customers,
        meta: { total: server.customers.length, page: 1, pageSize: 10, pageCount: 1 },
      })
    }
    return httpResponse(200, { data: [] })
  })
})

afterEach(() => {
  cleanup()
  vi.mocked(fetchWithAuth).mockReset()
})

describe('CustomerList create behind a pending row (ADR-0036 R1)', () => {
  // Scenario 5: the placeholder shows the entered values only, and the server row replaces it exactly once.
  it('shows a pending row without actions while the create is open, then swaps in the server row once', async () => {
    renderList()
    await screen.findByText(deCustomers.list.empty)
    server.postGate = deferred<Response>()

    await submitCustomer()

    expect(pendingRows()).toHaveLength(1)
    const [row] = bodyRows()
    expect(row).toHaveTextContent('Pia Pilot')
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(within(row!).queryAllByRole('button')).toHaveLength(0)
    expect(within(row!).queryAllByRole('link')).toHaveLength(0)
    fireEvent.contextMenu(row!)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()

    server.customers = [serverCustomer('srv-1', 'Pia', 'Pilot')]
    server.postGate.resolve(httpResponse(201, serverCustomer('srv-1', 'Pia', 'Pilot')))

    await waitFor(() => expect(pendingRows()).toHaveLength(0))
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('Pia Pilot')
    expect(bodyRows()[0]).not.toHaveAttribute('aria-disabled', 'true')
    await settle()
    expect(server.posts).toHaveLength(1)
    expect(server.gets).toBe(2)
  })

  // Duplicate submission: two clicks within one opening of the dialog create one customer.
  it('sends one create when the submit button is clicked twice', async () => {
    renderList()
    await screen.findByText(deCustomers.list.empty)
    server.postGate = deferred<Response>()

    await submitCustomer(2)
    await settle()

    expect(server.posts).toHaveLength(1)
    expect(pendingRows()).toHaveLength(1)
  })

  // A record that does not match the refetched page must not be forced into it.
  it('drops the pending row when the refetched page does not contain the new customer', async () => {
    server.customers = [serverCustomer('old-1', 'Otto', 'Alt')]
    renderList()
    await screen.findByText('Otto Alt')
    server.postGate = deferred<Response>()
    await submitCustomer()
    expect(pendingRows()).toHaveLength(1)

    server.postGate.resolve(httpResponse(201, serverCustomer('srv-1', 'Pia', 'Pilot')))

    await waitFor(() => expect(pendingRows()).toHaveLength(0))
    expect(bodyRows()).toHaveLength(1)
    expect(screen.queryByText('Pia Pilot')).not.toBeInTheDocument()
  })

  it('keeps the entered values with a message and Dismiss, and no Retry, when the server refuses', async () => {
    renderList()
    await screen.findByText(deCustomers.list.empty)
    server.postGate = deferred<Response>()
    await submitCustomer()

    server.postGate.resolve(httpResponse(500, { message: 'boom' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(deCustomers.dialog.saveFailed)
    expect(bodyRows()[0]).toHaveTextContent('Pia Pilot')
    expect(within(alert).queryByRole('button', { name: loading.retry })).not.toBeInTheDocument()
    fireEvent.click(within(alert).getByRole('button', { name: loading.dismiss }))
    expect(screen.queryByText('Pia Pilot')).not.toBeInTheDocument()
    expect(server.posts).toHaveLength(1)
  })

  it('shows the permission message on 403', async () => {
    renderList()
    await screen.findByText(deCustomers.list.empty)
    server.postGate = deferred<Response>()
    await submitCustomer()

    server.postGate.resolve(httpResponse(403, { message: 'Forbidden resource' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(errorsDe.codes.HTTP_403)
  })

  // A lost response proves nothing: the row says "not confirmed" and tells the user to check the list, with no retry.
  it('marks a lost response as not confirmed instead of failed', async () => {
    renderList()
    await screen.findByText(deCustomers.list.empty)
    server.postGate = deferred<Response>()
    await submitCustomer()

    server.postGate.reject(new TypeError('Failed to fetch'))

    expect(await screen.findByRole('alert')).toHaveTextContent(deCustomers.dialog.createUnconfirmed)
    expect(screen.queryByRole('button', { name: loading.retry })).not.toBeInTheDocument()
  })
})
