import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as estimateApi from '@/api/workshop-estimates'
import type { WorkshopEstimateListRow } from '@/api/workshop-estimates'
import { deWorkshop } from '@/test/de-workshop'
import WorkshopEstimateList from './WorkshopEstimateList'

const text = deWorkshop.estimateList

const authState = vi.hoisted(() => ({ role: 'SALES' }))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: authState.role } }),
}))
vi.mock('@/api/workshop-estimates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop-estimates')>()
  return { ...actual, useWorkshopEstimateList: vi.fn() }
})
vi.mock('@/api/customers', () => ({ useCustomers: () => ({ data: { data: [] }, isLoading: false }) }))

function row(overrides: Partial<WorkshopEstimateListRow>): WorkshopEstimateListRow {
  return {
    version_id: 'ver-1',
    estimate_number: 'KV-2026-0001',
    version: 2,
    status: 'SENT',
    order_id: 'order-1',
    order_number: 'WO-2026-0007',
    customer_id: 'cust-1',
    customer_name: 'Muster GmbH',
    vehicle_plate: 'W-123AB',
    sent_at: '2026-10-01T08:00:00.000Z',
    valid_until: '2026-10-15T08:00:00.000Z',
    decided_at: null,
    total_gross: '1234.50',
    ...overrides,
  }
}

const fetchNextPage = vi.fn()

function mockList(rows: WorkshopEstimateListRow[], overrides: Record<string, unknown> = {}) {
  vi.mocked(estimateApi.useWorkshopEstimateList).mockReturnValue({
    data: { pages: [{ data: rows, meta: { page_size: 25, next_cursor: null } }] },
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage,
    ...overrides,
  } as unknown as ReturnType<typeof estimateApi.useWorkshopEstimateList>)
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.hash}`}</div>
}

function renderList(path = '/workshop/estimates') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/workshop/estimates" element={<WorkshopEstimateList />} />
          <Route path="/workshop/orders/:id" element={<h1>Work order</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('WorkshopEstimateList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.role = 'SALES'
  })
  afterEach(cleanup)

  it('asks for SENT by default and shows the row columns', () => {
    mockList([row({})])
    renderList()

    expect(vi.mocked(estimateApi.useWorkshopEstimateList)).toHaveBeenCalledWith({ status: 'SENT' })
    expect(screen.getByText('KV-2026-0001')).toBeInTheDocument()
    expect(screen.getByText('WO-2026-0007')).toBeInTheDocument()
    expect(screen.getByText('Muster GmbH')).toBeInTheDocument()
    expect(screen.getByText('W-123AB')).toBeInTheDocument()
    expect(screen.getAllByText('Gesendet')).toHaveLength(2) // the chip and the row's badge
  })

  it('opens the work order at the estimate version when a row is clicked', () => {
    mockList([row({})])
    renderList()

    fireEvent.click(screen.getByText('W-123AB'))

    expect(screen.getByRole('heading', { name: 'Work order' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/workshop/orders/order-1#estimate-version-2')
  })

  it('offers the open action with its registry id in the row menu', () => {
    mockList([row({})])
    renderList()

    fireEvent.contextMenu(screen.getByText('W-123AB'))

    expect(document.querySelector('[data-action-id="estimate.open"]')).not.toBeNull()
  })

  it('offers no open action to a role that cannot manage estimates', () => {
    authState.role = 'TECH'
    mockList([row({})])
    renderList()

    fireEvent.contextMenu(screen.getByText('W-123AB'))

    expect(document.querySelector('[data-action-id="estimate.open"]')).toBeNull()
  })

  it('sends the chosen status, and SUPERSEDED once older versions are shown', () => {
    mockList([row({})])
    renderList()

    fireEvent.click(screen.getByTestId('estimate-status-chip-APPROVED'))
    expect(vi.mocked(estimateApi.useWorkshopEstimateList)).toHaveBeenLastCalledWith({ status: 'APPROVED' })

    fireEvent.click(screen.getByRole('checkbox', { name: text.filters.showOlder }))
    expect(vi.mocked(estimateApi.useWorkshopEstimateList)).toHaveBeenLastCalledWith({ status: 'SUPERSEDED' })
    expect(screen.getByTestId('estimate-status-chip-ALL')).toBeDisabled()
  })

  it('shows the empty state', () => {
    mockList([])
    renderList()

    expect(screen.getByText(text.empty)).toBeInTheDocument()
  })

  it('loads the next page only when asked', () => {
    mockList([row({})], { hasNextPage: true })
    renderList()

    fireEvent.click(screen.getByRole('button', { name: text.loadMore }))

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('says that search and sort cover the loaded entries while more can be loaded', () => {
    mockList([row({})], { hasNextPage: true })
    renderList('/workshop/estimates?search=KV')
    expect(screen.getByText(text.partialHint)).toBeInTheDocument()
    cleanup()

    mockList([row({})], { hasNextPage: true })
    renderList()
    expect(screen.queryByText(text.partialHint)).toBeNull()
  })

  it('hides the load-more button on the last page and marks an expired validity', () => {
    mockList([row({ status: 'EXPIRED' })])
    renderList('/workshop/estimates?status=EXPIRED')

    expect(screen.queryByRole('button', { name: text.loadMore })).toBeNull()
    const cell = screen.getAllByText('15.10.2026')[0]!
    expect(cell.className).toContain('text-destructive')
    expect(within(screen.getByTestId('estimate-list-filters')).getByTestId('estimate-status-chip-EXPIRED')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
