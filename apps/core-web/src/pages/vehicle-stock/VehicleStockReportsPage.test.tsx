import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { triggerBlobDownload } from '@/lib/download'
import VehicleStockReportsPage from './VehicleStockReportsPage'

vi.mock('@/api/vehicle-stock')
vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><VehicleStockReportsPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VehicleStockReportsPage', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(vehicleStockApi.useVehicleStockAgeReport).mockReturnValue({
      data: {
        data: [{
          id: 'vehicle-1', make: 'Audi', model: 'A4', year: 2020, vin: 'WAU123',
          plate: 'W-123AB', inventory_role: 'USED', stock_status: 'IN_STOCK',
          days_in_stock: 95, missing_stock_in_date: false,
          stock_in_date: '2026-07-01T00:00:00.000Z', age_bucket: '91_180',
          cost_basis: '12345.60', asking_price: '15000.00', location: 'Halle 1',
        }],
        meta: { total: 1, page: 1, limit: 25, pageSize: 25, totalPages: 1, pageCount: 1 },
        summary: { over_90_count: 1, over_90_cost_basis: '12345.60' },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockAgeReport>)
    vi.mocked(vehicleStockApi.useVehicleStockMarginReport).mockReturnValue({
      data: {
        data: [],
        meta: { total: 0, page: 1, limit: 25, pageSize: 25, totalPages: 0, pageCount: 0 },
        totals: { count: 0, gross_margin_total: '0.00', gross_margin_average: null, by_inventory_role: {} },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockMarginReport>)
  })

  it('exports the exact visible stock age rows as German semicolon CSV', async () => {
    renderPage()
    expect(screen.getByText('Audi A4 (2020)')).toBeInTheDocument()
    expect(screen.getByText('W-123AB')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /CSV exportieren/i }))

    await waitFor(async () => {
      expect(triggerBlobDownload).toHaveBeenCalledTimes(1)
      const [blob] = vi.mocked(triggerBlobDownload).mock.calls[0]!
      const csv = await blob.text()
      expect(csv).toContain('Marke;Modell;Baujahr')
      expect(csv).toContain('Audi;A4;2020;WAU123;W-123AB;USED;IN_STOCK;95;12345,60;15000,00;Halle 1')
    })
  })

  it('exports the exact visible invoiced margin rows as German semicolon CSV', async () => {
    vi.mocked(vehicleStockApi.useVehicleStockMarginReport).mockReturnValue({
      data: {
        data: [{
          id: 'sale-1', sale_number: 'VS-1', vehicle_id: 'vehicle-1', make: 'Audi',
          model: 'A4', year: 2020, inventory_role: 'USED', invoice_date: '2026-10-05T00:00:00.000Z',
          sale_price: '12000.00', cost_basis_snapshot: '10000.00', gross_margin_eur: '2000.00',
          gross_margin_percent: '16.67', days_to_sell: 40, margin_taxed: true,
        }],
        meta: { total: 1, page: 1, limit: 25, pageSize: 25, totalPages: 1, pageCount: 1 },
        totals: { count: 1, gross_margin_total: '2000.00', gross_margin_average: '2000.00', by_inventory_role: {} },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockMarginReport>)
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Rohertrag' }))
    expect(screen.getByText('VS-1')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByText((content) => content.includes('2000,00'))).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /CSV exportieren/i }))

    await waitFor(async () => {
      expect(triggerBlobDownload).toHaveBeenCalledTimes(1)
      const [blob] = vi.mocked(triggerBlobDownload).mock.calls[0]!
      const csv = await blob.text()
      expect(csv).toContain('Rechnungsdatum;Verkaufsnummer;Marke')
      expect(csv).toContain('5.10.2026;VS-1;Audi;A4;2020;USED;12000,00;10000,00;2000,00;16,67;40;Ja')
    })
  })
})
