import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopOrderList from './WorkshopOrderList'
import * as workshopApi from '@/api/workshop'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deCommon from '../../../../../locales/de/common.json'
import deWorkshop from '../../../../../locales/de/workshop.json'
import { PEEK_SEARCH_PARAM } from '@/features/peek/peek-search-param'

vi.mock('@/api/workshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop')>()
  return {
    ...actual,
    useWorkshopOrders: vi.fn(),
    useWorkshopOrder: vi.fn(),
    useGenerateWorkshopPdf: vi.fn(),
  }
})
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/components/workshop/WorkshopOrderIntakeDialog', () => ({
  WorkshopOrderIntakeDialog: () => null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const orderRow = {
  id: 'order-1',
  order_number: 'WO-42',
  status: 'INTAKE',
  createdAt: '2026-01-15T00:00:00.000Z',
  customer: { first_name: 'Ada', last_name: 'Lovelace' },
  vehicle: { year: 2024, make: 'Audi', model: 'A4' },
}

function UrlSearchProbe() {
  const location = useLocation()
  return <span data-testid="url-search">{location.search}</span>
}

function renderList(initialEntry = '/workshop/orders?page=2') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route
                path="/workshop/orders"
                element={
                  <>
                    <UrlSearchProbe />
                    <WorkshopOrderList />
                  </>
                }
              />
              <Route path="/workshop/orders/:id" element={<h1>Full order page</h1>} />
            </Routes>
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

describe('WorkshopOrderList peek sheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(workshopApi.useWorkshopOrders).mockReturnValue({
      data: {
        data: [orderRow],
        meta: { pageCount: 1, total: 1, page: 2, pageSize: 10 },
      },
      isLoading: false,
      isError: false,
    })
    asMock(workshopApi.useWorkshopOrder).mockImplementation((id: string) => ({
      data: id === 'order-1' ? orderRow : undefined,
      isLoading: false,
    }))
    asMock(workshopApi.useGenerateWorkshopPdf).mockReturnValue({ mutateAsync: vi.fn() })
  })

  it('opens the peek sheet on row click and keeps list query params', async () => {
    renderList()

    const customerCell = screen.getByText('Ada Lovelace')
    act(() => customerCell.click())

    const sheet = await screen.findByTestId('entity-peek-sheet')
    expect(within(sheet).getByText('WO-42')).toBeInTheDocument()
    expect(within(sheet).getByText('2024 Audi A4')).toBeInTheDocument()
    expect(screen.getByTestId('url-search').textContent).toContain(`${PEEK_SEARCH_PARAM}=order-1`)
    expect(screen.getByTestId('url-search').textContent).toContain('page=2')
    expect(screen.getAllByText('WO-42').length).toBeGreaterThan(1)
  })

  it('opens from a deep link and shows empty state for unknown ids', async () => {
    asMock(workshopApi.useWorkshopOrder).mockReturnValue({ data: undefined, isLoading: false })
    renderList(`/workshop/orders?page=2&${PEEK_SEARCH_PARAM}=missing`)

    expect(await screen.findByText(deWorkshop.orders.peek.notFound)).toBeInTheDocument()
  })

  it('closes via Escape and removes only the peek param', async () => {
    renderList(`/workshop/orders?page=2&${PEEK_SEARCH_PARAM}=order-1`)
    await screen.findByTestId('entity-peek-sheet')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByTestId('entity-peek-sheet')).not.toBeInTheDocument()
    expect(screen.getByTestId('url-search').textContent).toBe('?page=2')
  })

  it('opens the full page when the detail link cell is clicked', async () => {
    renderList()
    const link = screen.getByRole('link', {
      name: deWorkshop.orders.list.rowAria.replace('{{orderNo}}', 'WO-42'),
    })
    act(() => link.click())
    expect(await screen.findByRole('heading', { name: 'Full order page' })).toBeInTheDocument()
  })

  it('navigates to full detail via Open in full', async () => {
    renderList(`/workshop/orders?${PEEK_SEARCH_PARAM}=order-1`)
    const sheet = await screen.findByTestId('entity-peek-sheet')

    act(() => within(sheet).getByRole('link', { name: deCommon.peek.openInFull }).click())

    expect(await screen.findByRole('heading', { name: 'Full order page' })).toBeInTheDocument()
  })

  it('uses full-width sheet classes on small screens', async () => {
    renderList(`/workshop/orders?${PEEK_SEARCH_PARAM}=order-1`)
    const sheet = await screen.findByTestId('entity-peek-sheet')
    expect(sheet.className).toContain('w-full')
    expect(sheet.className).toContain('sm:max-w-3xl')
    expect(within(sheet).getByRole('link', { name: deCommon.peek.openInFull }).className).toContain(
      'min-h-11',
    )
  })
})
