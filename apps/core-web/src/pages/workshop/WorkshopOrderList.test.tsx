import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopOrderList from './WorkshopOrderList'
import * as workshopApi from '@/api/workshop'
import { deWorkshop } from '@/test/de-workshop'

const list = deWorkshop.orders.list

vi.mock('@/api/workshop')
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/components/data-table/DataTable', () => ({
  DataTable: () => null,
}))
vi.mock('@/components/workshop/WorkshopOrderIntakeDialog', () => ({
  WorkshopOrderIntakeDialog: () => null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/workshop/orders']}>
        <Routes>
          <Route path="/workshop/orders" element={<WorkshopOrderList />} />
          <Route path="/workshop/pick-list" element={<h1>Pick list route</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('WorkshopOrderList parts pick queue button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(workshopApi.useWorkshopOrders).mockReturnValue({ data: undefined, isLoading: false })
  })

  afterEach(() => {
    cleanup()
  })

  it('labels the header button "Parts pick queue" and keeps it enabled', () => {
    renderList()

    expect(screen.getByRole('button', { name: list.partsPickQueue })).toBeEnabled()
  })

  it('shows the button description as a tooltip when the button gets keyboard focus', async () => {
    renderList()

    act(() => screen.getByRole('button', { name: list.partsPickQueue }).focus())

    expect(await screen.findByRole('tooltip')).toHaveTextContent(list.partsPickHint)
  })

  it('opens the pick list route when the button is activated', async () => {
    renderList()

    act(() => screen.getByRole('button', { name: list.partsPickQueue }).click())

    expect(await screen.findByRole('heading', { name: 'Pick list route' })).toBeInTheDocument()
  })
})
