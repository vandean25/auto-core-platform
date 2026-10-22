import { act, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VehicleList from './VehicleList'
import * as vehiclesApi from '@/api/vehicles'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deCommon from '../../../../../locales/de/common.json'
import deVehicles from '../../../../../locales/de/vehicles.json'
import { PEEK_SEARCH_PARAM } from '@/features/peek/peek-search-param'

vi.mock('@/api/vehicles')
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/components/vehicles/VehicleDialog', () => ({
  VehicleDialog: () => null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const vehicle = {
  id: 'veh-1',
  year: 2022,
  make: 'VW',
  model: 'Golf',
  vin: 'WVWZZZ1JZYW000001',
  plate: 'W-12345',
  customer: {
    type: 'PRIVATE' as const,
    first_name: 'Max',
    last_name: 'Mustermann',
  },
}

function UrlSearchProbe() {
  const location = useLocation()
  return <span data-testid="url-search">{location.search}</span>
}

function renderList(initialEntry = '/vehicles?search=golf') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route
                path="/vehicles"
                element={
                  <>
                    <UrlSearchProbe />
                    <VehicleList />
                  </>
                }
              />
              <Route path="/vehicles/:id" element={<h1>Full vehicle page</h1>} />
            </Routes>
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

describe('VehicleList peek sheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(vehiclesApi.useVehicles).mockReturnValue({
      data: { data: [vehicle], meta: { pageCount: 1 } },
      isLoading: false,
    })
    asMock(vehiclesApi.useVehicle).mockImplementation((id: string) => ({
      data: id === 'veh-1' ? vehicle : undefined,
      isLoading: false,
    }))
  })

  it('opens peek on row click and keeps search param', async () => {
    renderList()
    act(() => screen.getByText('2022').click())

    const sheet = await screen.findByTestId('entity-peek-sheet')
    expect(within(sheet).getByText('2022 VW Golf')).toBeInTheDocument()
    expect(screen.getByTestId('url-search').textContent).toContain(`${PEEK_SEARCH_PARAM}=veh-1`)
    expect(screen.getByTestId('url-search').textContent).toContain('search=golf')
  })

  it('shows not found for unknown peek id', async () => {
    asMock(vehiclesApi.useVehicle).mockReturnValue({ data: undefined, isLoading: false })
    renderList(`/vehicles?${PEEK_SEARCH_PARAM}=missing`)
    expect(await screen.findByText(deVehicles.peek.notFound)).toBeInTheDocument()
  })

  it('opens full page from detail link cell', async () => {
    renderList()
    const link = screen.getByRole('link', {
      name: deVehicles.list.rowAria.replace('{{vehicle}}', 'VW Golf'),
    })
    act(() => link.click())
    expect(await screen.findByRole('heading', { name: 'Full vehicle page' })).toBeInTheDocument()
  })

  it('open in full navigates to detail route', async () => {
    renderList(`/vehicles?${PEEK_SEARCH_PARAM}=veh-1`)
    const sheet = await screen.findByTestId('entity-peek-sheet')
    act(() => within(sheet).getByRole('link', { name: deCommon.peek.openInFull }).click())
    expect(await screen.findByRole('heading', { name: 'Full vehicle page' })).toBeInTheDocument()
  })
})
