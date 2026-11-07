import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { toast } from 'sonner'
import { deVehicleStock } from '@/test/de-vehicleStock'
import errorsDe from '../../../../../locales/de/errors.json'
import VehicleStockDetail from './VehicleStockDetail'

vi.mock('@/api/vehicle-stock')
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/api/workshop', () => ({ useCreateWorkshopOrder: () => ({ mutateAsync: vi.fn() }) }))
vi.mock('@/api/customers', () => ({
  useCustomers: () => ({ data: { data: [{ id: 'cust-9', type: 'PRIVATE', first_name: 'Pilot', last_name: 'Customer' }] } }),
}))

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

  // Regression: the loading state was a bare text line instead of a skeleton.
  it('WHEN the vehicle stock detail is loading THEN a Skeleton is shown instead of the loading text', async () => {
    mockDetail({ data: undefined, isLoading: true })
    const { container } = renderPage()

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(deVehicleStock.stockDetail.loading)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
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

  // Scenario 4 (reserve): the reservation is a shared-resource write, so it waits for the server and only the picker shows pending.
  it('WHEN a customer is picked for the reservation THEN only the picker is pending and the page waits for the server', async () => {
    let resolvePatch: ((value: unknown) => void) | undefined
    const mutateAsync = vi.fn().mockReturnValue(new Promise((resolve) => { resolvePatch = resolve }))
    vi.mocked(vehicleStockApi.usePatchVehicleStock).mockReturnValue(
      { mutateAsync } as unknown as ReturnType<typeof vehicleStockApi.usePatchVehicleStock>,
    )
    mockDetail({ data: stockVehicle })
    renderPage()

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByText('Pilot Customer'))

    expect(mutateAsync).toHaveBeenCalledWith({ reserved_for_customer_id: 'cust-9' })
    const picker = screen.getByRole('combobox')
    expect(picker).toHaveAttribute('aria-busy', 'true')
    expect(picker).toBeDisabled()
    // Nothing else on the page is pending and nothing shows the reservation before the server confirmed it.
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: deVehicleStock.stockDetail.sell })).toBeEnabled()
    expect(screen.queryByText('Pilot Customer')).not.toBeInTheDocument()

    await act(async () => resolvePatch?.({}))
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-busy', 'true')
  })

  // Scenario 2/3 for the stock detail: the editor closes at once, a rejection leaves a marker and a 403 gets the permission text.
  it.each([
    { name: 'a rejection', error: new Error('rejected'), toastText: deVehicleStock.stockDetail.saveFailed },
    { name: 'HTTP 403', error: Object.assign(new Error('Forbidden resource'), { status: 403 }), toastText: errorsDe.codes.HTTP_403 },
  ])('WHEN the server answers $name to a color edit THEN a marker names the vehicle and field and the toast is right', async ({ error, toastText }) => {
    const mutateAsync = vi.fn().mockRejectedValue(error)
    vi.mocked(vehicleStockApi.usePatchVehicleStock).mockReturnValue(
      { mutateAsync } as unknown as ReturnType<typeof vehicleStockApi.usePatchVehicleStock>,
    )
    mockDetail({ data: stockVehicle })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Schwarz' }))
    const input = screen.getByPlaceholderText(deVehicleStock.stockDetail.color)
    fireEvent.change(input, { target: { value: 'Rot' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '2020 Audi A4: Farbe nicht gespeichert, vorheriger Wert wiederhergestellt.',
    )
    expect(mutateAsync).toHaveBeenCalledWith({ color: 'Rot' })
    expect(toast.error).toHaveBeenCalledWith(toastText)
    expect(screen.queryByPlaceholderText(deVehicleStock.stockDetail.color)).not.toBeInTheDocument()
  })
})
