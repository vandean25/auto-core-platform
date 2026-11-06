import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import VehicleList from './VehicleList'
import * as vehiclesApi from '@/api/vehicles'
import { vehicleKeys } from '@/api/vehicles'
import * as customersApi from '@/api/customers'
import { customerKeys } from '@/api/customers'
import * as salesApi from '@/api/sales'
import { invoiceKeys } from '@/api/sales'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { vehicleStockKeys } from '@/api/vehicle-stock'
import * as inventoryApi from '@/api/inventory'
import { inventoryKeys } from '@/api/inventory'
import * as locationsApi from '@/api/locations'
import CustomerList from '@/pages/customers/CustomerList'
import InvoiceListPage from '@/pages/sales/InvoiceListPage'
import VehicleStockList from '@/pages/vehicle-stock/VehicleStockList'
import InventoryList from '@/pages/InventoryList'
import { mockListLayout } from '@/components/data-table/data-table-infinite-test-utils'
import { resetIntentPrefetchScheduler } from '@/lib/intent-prefetch'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deCommon from '../../../../../locales/de/common.json'
import deVehicles from '../../../../../locales/de/vehicles.json'
import { PEEK_SEARCH_PARAM } from '@/features/peek/peek-search-param'

vi.mock('@/api/vehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/vehicles')>()
  return {
    ...actual,
    useVehicles: vi.fn(),
    useVehicle: vi.fn(),
  }
})
vi.mock('@/api/customers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/customers')>()
  return {
    ...actual,
    useCustomers: vi.fn(),
    useCustomer: vi.fn(),
    useDeleteCustomer: vi.fn(),
  }
})
vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/sales')>()
  return {
    ...actual,
    useInvoices: vi.fn(),
  }
})
vi.mock('@/api/vehicle-stock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/vehicle-stock')>()
  return {
    ...actual,
    useVehicleStock: vi.fn(),
    useDeleteVehiclePurchase: vi.fn(),
  }
})
vi.mock('@/api/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/inventory')>()
  return {
    ...actual,
    useInventory: vi.fn(),
    useInventoryCursorList: vi.fn(),
  }
})
vi.mock('@/api/locations', () => ({
  useLocations: vi.fn(() => ({ data: [], isLoading: false })),
}))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/components/vehicles/VehicleDialog', () => ({
  VehicleDialog: () => null,
}))
vi.mock('@/components/customers/CustomerDialog', () => ({
  CustomerDialog: () => null,
}))
vi.mock('@/components/AddItemDialog', () => ({
  AddItemDialog: () => null,
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

function renderList(initialEntry = '/vehicles?search=golf', queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
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
    resetIntentPrefetchScheduler()
    asMock(vehiclesApi.useVehicles).mockReturnValue({
      data: { data: [vehicle], meta: { pageCount: 1 } },
      isLoading: false,
    })
    asMock(vehiclesApi.useVehicle).mockImplementation((id: string) => ({
      data: id === 'veh-1' ? vehicle : undefined,
      isLoading: false,
    }))
  })

  afterEach(() => {
    resetIntentPrefetchScheduler()
    vi.useRealTimers()
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

  function mockMainListsForPrefetch(): void {
    asMock(customersApi.useCustomers).mockReturnValue({
      data: {
        data: [{ id: 'cust-1', type: 'PRIVATE', first_name: 'Max', last_name: 'Mustermann' }],
        meta: { pageCount: 1 },
      },
      isLoading: false,
      isError: false,
    })
    asMock(customersApi.useCustomer).mockReturnValue({ data: undefined, isLoading: false })
    asMock(customersApi.useDeleteCustomer).mockReturnValue({ mutateAsync: vi.fn() })
    asMock(salesApi.useInvoices).mockReturnValue({
      data: [
        {
          id: 'inv-1',
          status: 'FINALIZED',
          customer_id: 'cust-1',
          customer: { id: 'cust-1', type: 'PRIVATE', first_name: 'Max', last_name: 'Mustermann' },
          date: '2026-01-15T00:00:00.000Z',
          total_gross: '120.00',
          invoice_number: 'RE-2026-0001',
        },
      ],
      isLoading: false,
    })
    asMock(vehicleStockApi.useVehicleStock).mockReturnValue({
      data: {
        data: [{ id: 'stock-1', make: 'Audi', model: 'A4', year: 2023, stock_status: 'IN_STOCK' }],
        meta: { pageCount: 1, total: 1, page: 1, pageSize: 10 },
      },
      isLoading: false,
    })
    asMock(vehicleStockApi.useDeleteVehiclePurchase).mockReturnValue({ mutateAsync: vi.fn() })
    asMock(inventoryApi.useInventory).mockReturnValue({
      data: {
        data: [{ id: 'item-1', sku: 'BRK-001', name: 'Brake Pad', price: 49.9, status: 'IN_STOCK' }],
        meta: { pageCount: 1, total: 1, page: 1, limit: 10 },
      },
      isLoading: false,
    })
    // The parts list opens in infinite mode (AUT-890); its rows come from the cursor hook.
    asMock(inventoryApi.useInventoryCursorList).mockReturnValue({
      rows: [{ id: 'item-1', sku: 'BRK-001', name: 'Brake Pad', price: 49.9, status: 'IN_STOCK' }],
      tableProps: {
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
        isError: false,
        onRetry: vi.fn(),
        hasUsableData: true,
        infinite: {
          queryKey: ['inventory', 'cursor-list', {}],
          hasNextPage: false,
          isFetchingNextPage: false,
          isFetchNextPageError: false,
          fetchNextPage: vi.fn(),
        },
      },
    })
    asMock(locationsApi.useLocations).mockReturnValue({ data: [], isLoading: false })
  }

  it.each([
    {
      name: 'vehicles',
      Component: VehicleList,
      expectedKey: vehicleKeys.detail('veh-1'),
    },
    {
      name: 'customers',
      Component: CustomerList,
      expectedKey: customerKeys.detail('cust-1'),
    },
    {
      name: 'invoices',
      Component: InvoiceListPage,
      expectedKey: invoiceKeys.detail('inv-1'),
    },
    {
      name: 'stock vehicles',
      Component: VehicleStockList,
      expectedKey: vehicleStockKeys.detail('stock-1'),
      stockRow: { id: 'stock-1', make: 'Audi', model: 'A4', year: 2023, stock_status: 'IN_STOCK' },
    },
    {
      name: 'stock vehicle draft purchases',
      Component: VehicleStockList,
      expectedKey: vehicleStockKeys.purchase('purch-1'),
      stockRow: {
        id: 'stock-draft-1',
        draft_purchase_id: 'purch-1',
        make: 'BMW',
        model: '320d',
        year: 2024,
        stock_status: 'IN_PREPARATION',
      },
    },
    {
      name: 'parts',
      Component: InventoryList,
      expectedKey: inventoryKeys.detail('item-1'),
      stockRow: undefined,
    },
  ])(
    'WHEN the user hovers a $name row for 100 ms THEN the detail query is prefetched once',
    ({ Component, expectedKey, stockRow }) => {
      vi.useFakeTimers()
      // jsdom has no layout; the infinite parts list virtualizes its rows.
      const restoreLayout = mockListLayout()
      onTestFinished(restoreLayout)
      mockMainListsForPrefetch()
      if (stockRow) {
        asMock(vehicleStockApi.useVehicleStock).mockReturnValue({
          data: {
            data: [stockRow],
            meta: { pageCount: 1, total: 1, page: 1, pageSize: 10 },
          },
          isLoading: false,
        })
      }
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined)

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <SavedViewsProvider userKey="test-user">
            <DashboardWidgetsProvider userKey="test-user">
              <MemoryRouter>
                <Component />
              </MemoryRouter>
            </DashboardWidgetsProvider>
          </SavedViewsProvider>
        </QueryClientProvider>,
      )

      const row = container.querySelector('tbody tr[data-table-row="true"]')
      expect(row).not.toBeNull()

      fireEvent.pointerEnter(row!, { pointerType: 'mouse' })
      vi.advanceTimersByTime(99)
      expect(prefetchSpy).toHaveBeenCalledTimes(0)

      vi.advanceTimersByTime(1)
      expect(prefetchSpy).toHaveBeenCalledTimes(1)
      expect(prefetchSpy.mock.calls[0]?.[0]).toMatchObject({
        queryKey: expectedKey,
      })
    },
  )
})
