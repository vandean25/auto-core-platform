import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopOrderList from './WorkshopOrderList'
import * as workshopApi from '@/api/workshop'

vi.mock('@/api/workshop')
vi.mock('@/components/data-table/DataTable', () => ({
  DataTable: () => null,
}))
vi.mock('@/components/workshop/WorkshopOrderIntakeDialog', () => ({
  WorkshopOrderIntakeDialog: () => null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/workshop/orders']}>
      <Routes>
        <Route path="/workshop/orders" element={<WorkshopOrderList />} />
        <Route path="/workshop/pick-list" element={<h1>Pick list route</h1>} />
      </Routes>
    </MemoryRouter>,
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

    expect(screen.getByRole('button', { name: 'Parts pick queue' })).toBeEnabled()
  })

  it('shows the button description as a tooltip when the button gets keyboard focus', async () => {
    renderList()

    act(() => screen.getByRole('button', { name: 'Parts pick queue' }).focus())

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Parts to pick for open workshop orders',
    )
  })

  it('opens the pick list route when the button is activated', async () => {
    renderList()

    act(() => screen.getByRole('button', { name: 'Parts pick queue' }).click())

    expect(await screen.findByRole('heading', { name: 'Pick list route' })).toBeInTheDocument()
  })
})
