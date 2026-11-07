import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { deVehicles } from '@/test/de-vehicles'
import deCommon from '../../../../../locales/de/common.json'
import VehicleList from './VehicleList'

// Only the network boundary is faked. The real list, create dialog, create mutation and vehicles query run together.
vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ claims: { role: 'ADMIN' } }) }))

const loading = deCommon.dataTable.loading

const httpResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

const serverVehicle = (id: string) => ({
  id,
  make: 'Skoda',
  model: 'Octavia',
  year: 2021,
  vin: 'TMBJJ7NE0M0123456',
  plate: 'W-12345',
  customer: null,
})

type Gate = { promise: Promise<Response>; resolve: (value: Response) => void }
type FakeServer = { vehicles: ReturnType<typeof serverVehicle>[]; gets: number; posts: Record<string, unknown>[]; gate: Gate | null }
let server: FakeServer

function newGate(): Gate {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

function renderList() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={['/vehicles']}>
            <Routes>
              <Route path="/vehicles" element={<VehicleList />} />
            </Routes>
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

async function submitVehicle(clicks = 1) {
  fireEvent.click(await screen.findByRole('button', { name: deVehicles.list.addVehicle }))
  fireEvent.change(await screen.findByLabelText(deVehicles.dialog.make), { target: { value: 'Skoda' } })
  fireEvent.change(screen.getByLabelText(deVehicles.dialog.model), { target: { value: 'Octavia' } })
  const submit = screen.getByRole('button', { name: deVehicles.dialog.create })
  for (let i = 0; i < clicks; i += 1) fireEvent.click(submit)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

const pendingRows = () => screen.queryAllByText(loading.pendingRow)
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const settle = () => act(() => new Promise((done) => setTimeout(done, 30)))

beforeEach(() => {
  server = { vehicles: [], gets: 0, posts: [], gate: null }
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    if (!String(url).startsWith('/api/vehicles')) return httpResponse(200, { data: [] })
    if (init?.method === 'POST') {
      server.posts.push(JSON.parse(String(init.body)))
      return server.gate ? server.gate.promise : httpResponse(201, serverVehicle('srv-1'))
    }
    server.gets += 1
    return httpResponse(200, { data: server.vehicles, meta: { total: server.vehicles.length, page: 1, pageSize: 10, pageCount: 1 } })
  })
})

afterEach(() => {
  cleanup()
  vi.mocked(fetchWithAuth).mockReset()
})

describe('VehicleList create behind a pending row (ADR-0036 R1)', () => {
  // Scenario 5 for vehicles: entered values only, no actions, and the server row replaces the placeholder once.
  it('shows a pending row without actions, then swaps in the server row once', async () => {
    renderList()
    await waitFor(() => expect(server.gets).toBe(1))
    server.gate = newGate()

    await submitVehicle()

    expect(pendingRows()).toHaveLength(1)
    const row = bodyRows().find((candidate) => candidate.textContent?.includes('Skoda Octavia'))!
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(within(row).queryAllByRole('button')).toHaveLength(0)

    server.vehicles = [serverVehicle('srv-1')]
    server.gate.resolve(httpResponse(201, serverVehicle('srv-1')))

    await waitFor(() => expect(pendingRows()).toHaveLength(0))
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('Skoda Octavia')
    await settle()
    expect(server.posts).toHaveLength(1)
  })

  it('sends one create when the submit button is clicked twice', async () => {
    renderList()
    await waitFor(() => expect(server.gets).toBe(1))
    server.gate = newGate()

    await submitVehicle(2)
    await settle()

    expect(server.posts).toHaveLength(1)
  })

  it('keeps the entered values with a message and Dismiss, and no Retry, when the server refuses', async () => {
    renderList()
    await waitFor(() => expect(server.gets).toBe(1))
    server.gate = newGate()
    await submitVehicle()

    server.gate.resolve(httpResponse(500, { message: 'boom' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(deVehicles.dialog.saveFailed)
    expect(within(alert).queryByRole('button', { name: loading.retry })).not.toBeInTheDocument()
    fireEvent.click(within(alert).getByRole('button', { name: loading.dismiss }))
    expect(pendingRows()).toHaveLength(0)
  })
})
