import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { mockListLayout, settleVirtualizerTimers } from '@/components/data-table/data-table-infinite-test-utils'
import deCommon from '../../../../../locales/de/common.json'
import deVehicleStock from '../../../../../locales/de/vehicleStock.json'
import VehicleStockList from './VehicleStockList'

vi.mock('@/api/vehicle-stock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/vehicle-stock')>()),
  useVehicleStock: vi.fn(),
  useVehicleStockCursorList: vi.fn(),
  useDeleteVehiclePurchase: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ claims: { role: 'ADMIN' } }) }))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>
const row = { id: 'veh-1', make: 'Audi', model: 'A4', year: 2020, vin: 'WAUZZZ8K9BA000001', plate: 'W-1', color: 'Blau', stock_status: 'IN_STOCK' }

function renderAt(entry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={[entry]}>
            <VehicleStockList />
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

describe('VehicleStockList paging mode', () => {
  let restoreLayout: () => void

  beforeEach(() => {
    restoreLayout = mockListLayout()
    vi.clearAllMocks()
    asMock(vehicleStockApi.useVehicleStock).mockReturnValue({
      data: { data: [row], meta: { total: 1, page: 1, limit: 10, pageCount: 3 } },
      isLoading: false,
    })
    asMock(vehicleStockApi.useVehicleStockCursorList).mockReturnValue({
      rows: [row],
      tableProps: {
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
        isError: false,
        onRetry: vi.fn(),
        hasUsableData: true,
        infinite: {
          queryKey: ['vehicle-stock', 'cursor-list', {}],
          hasNextPage: false,
          isFetchingNextPage: false,
          isFetchNextPageError: false,
          fetchNextPage: vi.fn(),
          totalCount: { count: 1, isCapped: false },
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
    restoreLayout()
  })

  afterAll(settleVirtualizerTimers)

  // AUT-890: the API refuses cursor paging for "all statuses" (merged draft purchases), so that view keeps its pages.
  it.each([
    { entry: '/vehicle-stock', infinite: false },
    { entry: '/vehicle-stock?filter_stock_status=ON_ORDER', infinite: false },
    { entry: '/vehicle-stock?filter_stock_status=IN_STOCK&sortField=stock_status', infinite: false },
    { entry: '/vehicle-stock?filter_stock_status=IN_STOCK', infinite: true },
    { entry: '/vehicle-stock?filter_stock_status=SOLD&sortField=make&sortDirection=desc', infinite: true },
  ])('WHEN $entry is opened THEN infinite mode is $infinite', ({ entry, infinite }) => {
    renderAt(entry)

    expect(asMock(vehicleStockApi.useVehicleStock)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: !infinite }),
    )
    expect(asMock(vehicleStockApi.useVehicleStockCursorList)).toHaveBeenLastCalledWith(expect.anything(), infinite)
    if (infinite) {
      expect(screen.queryByRole('button', { name: deCommon.dataTable.next })).not.toBeInTheDocument()
      expect(screen.getByText('1 Treffer')).toBeInTheDocument()
    } else {
      expect(screen.getByRole('button', { name: deCommon.dataTable.next })).toBeInTheDocument()
      expect(screen.queryByText('1 Treffer')).not.toBeInTheDocument()
    }
  })

  // AUT-890: choosing a draft-free status in the select is what switches the list to infinite mode.
  it('WHEN a status is chosen in the filter THEN the list switches to infinite mode with that status filter', async () => {
    renderAt('/vehicle-stock')

    fireEvent.click(screen.getByRole('combobox', { name: deVehicleStock.stockList.statusFilterAria }))
    fireEvent.click(await screen.findByRole('option', { name: 'Auf Lager' }))

    expect(asMock(vehicleStockApi.useVehicleStockCursorList)).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: [{ field: 'stock_status', value: 'IN_STOCK' }] }),
      true,
    )
  })
})
