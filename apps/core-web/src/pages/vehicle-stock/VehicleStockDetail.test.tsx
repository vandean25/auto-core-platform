import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { deVehicleStock } from '@/test/de-vehicleStock'
import VehicleStockDetail from './VehicleStockDetail'

vi.mock('@/api/vehicle-stock')
vi.mock('@/api/workshop', () => ({ useCreateWorkshopOrder: () => ({ mutateAsync: vi.fn() }) }))
vi.mock('@/components/sales/CustomerSearch', () => ({ CustomerSearch: () => null }))

const stockVehicle = {
  id: 'veh-1', make: 'Audi', model: 'A4', year: 2020, vin: 'WAUZZZ8K9BA000001', stock_status: 'IN_STOCK',
  cost_basis: '12345.60', mileage: 1000, color: 'Schwarz', key_number: null, registration_certificate_no: null,
  reserved_for_customer: null, ledger_entries: [] as Array<{ id: string; entry_type: string; amount: string }>,
}

function mockDetail(result: { data?: unknown; isLoading?: boolean }) {
  vi.mocked(vehicleStockApi.useVehicleStockDetail).mockReturnValue(
    result as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockDetail>,
  )
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/vehicle-stock/veh-1']}>
        <Routes><Route path="/vehicle-stock/:vehicleId" element={<VehicleStockDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VehicleStockDetail (AUT-659)', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(vehicleStockApi.usePatchVehicleStock).mockReturnValue(
      { mutateAsync: vi.fn() } as unknown as ReturnType<typeof vehicleStockApi.usePatchVehicleStock>,
    )
  })

  // Regression: the loading state was a bare text line (and a spinner-like stand-in) instead of a skeleton.
  it('WHEN the vehicle stock detail is loading THEN a Skeleton is shown instead of a spinner', async () => {
    mockDetail({ data: undefined, isLoading: true })
    const { container } = renderPage()

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(deVehicleStock.stockDetail.loading)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  // Regression: the empty ledger was an ad-hoc paragraph, not the shared Empty.
  it('WHEN the ledger has no entries THEN the shared Empty is shown with the German text', () => {
    mockDetail({ data: stockVehicle })
    const { container } = renderPage()

    const empty = container.querySelector('[data-slot="empty"]')
    expect(empty).toHaveTextContent(deVehicleStock.stockDetail.noLedger)
    expect(screen.queryByRole('table')).toBeNull()
  })

  // Regression: the ledger was a hand-built raw <table>.
  it('WHEN the vehicle stock detail renders THEN the ledger is a ui/table and every entry is still shown', () => {
    mockDetail({
      data: {
        ...stockVehicle,
        ledger_entries: [
          { id: 'l1', entry_type: 'PURCHASE', amount: '12345.60' },
          { id: 'l2', entry_type: 'COST', amount: '250.00' },
        ],
      },
    })
    const { container } = renderPage()

    const region = screen.getByRole('region', { name: 'Scrollbare Tabelle' })
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(region.contains(container.querySelector('table'))).toBe(true)
    const table = within(region)
    expect(table.getByText('PURCHASE')).toBeInTheDocument()
    expect(table.getByText(/12\.345,60/)).toBeInTheDocument()
    expect(table.getByText('COST')).toBeInTheDocument()
    expect(table.getByText(/250,00/)).toBeInTheDocument()
  })
})
