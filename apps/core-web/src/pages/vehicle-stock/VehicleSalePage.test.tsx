import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VehicleSalePage from './VehicleSalePage'
import * as vehicleStockApi from '@/api/vehicle-stock'

const { createSale, updateSale, finalizeSale, calculateNova, resetNova } = vi.hoisted(() => ({
  createSale: vi.fn(),
  updateSale: vi.fn(),
  finalizeSale: vi.fn(),
  calculateNova: vi.fn(),
  resetNova: vi.fn(),
}))

vi.mock('@/api/vehicle-stock')
vi.mock('@/api/nova', () => ({
  useNovaCalculate: () => ({ mutate: calculateNova, reset: resetNova, data: undefined, error: null, isPending: false }),
}))
vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: () => <div>Selected buyer</div>,
}))
vi.mock('@/components/status/StatusBadge', () => ({ StatusBadge: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const existingSale = {
  id: 'sale-1',
  sale_number: 'VS-2026-0001',
  status: 'DRAFT',
  vehicle_id: 'vehicle-1',
  customer_id: 'buyer-1',
  sale_price: 12000,
  customer: {
    id: 'buyer-1',
    type: 'PRIVATE',
    first_name: 'Example',
    last_name: 'Buyer',
    email: 'buyer@example.test',
  },
}

const stockVehicle = {
  id: 'vehicle-1',
  year: 2018,
  make: 'Volkswagen',
  model: 'Golf',
  cost_basis: 10000,
  first_registration_date: '2020-01-02',
  co2_wltp_g_km: 145,
  co2_nedc_g_km: null,
  typenschein_no: 'TS-1',
  nova_class: 'STANDARD',
}

function asMock(fn: unknown) {
  return fn as ReturnType<typeof vi.fn>
}

describe('VehicleSalePage NoVA preview boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: existingSale })
    asMock(vehicleStockApi.useVehicleStockDetail).mockReturnValue({ data: stockVehicle })
    asMock(vehicleStockApi.useCreateVehicleSale).mockReturnValue({ mutateAsync: createSale })
    asMock(vehicleStockApi.useUpdateVehicleSale).mockReturnValue({ mutateAsync: updateSale })
    asMock(vehicleStockApi.useFinalizeVehicleSale).mockReturnValue({ mutateAsync: finalizeSale })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps the margin-sale update payload unchanged when the NoVA preview is used', async () => {
    render(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )

    const novaPrice = screen.getByLabelText('NoVA-Netto-Preis')
    fireEvent.change(novaPrice, { target: { value: '9999' } })
    fireEvent.click(screen.getByRole('button', { name: 'NoVA berechnen' }))

    expect(calculateNova).toHaveBeenCalledWith({
      vehicleId: 'vehicle-1',
      netPriceEuro: 9999,
    })

    fireEvent.change(screen.getByLabelText('Sale price (gross)'), {
      target: { value: '14500' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(updateSale).toHaveBeenCalledTimes(1)
    expect(updateSale).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: 'buyer-1',
      sale_price: 14500,
      buyer_is_consumer: true,
      gewaehrleistung_shortened_negotiated: false,
    }))
    expect(createSale).not.toHaveBeenCalled()
    expect(finalizeSale).not.toHaveBeenCalled()
  })

  it('saves current warranty edits before finalizing the invoice', async () => {
    let resolveUpdate: (() => void) | undefined
    updateSale.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveUpdate = resolve
    }))
    finalizeSale.mockResolvedValueOnce({ invoice: { id: 'invoice-1' } })

    render(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Übergabedatum'), {
      target: { value: '2026-10-08' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finalize invoice' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(updateSale).toHaveBeenCalledWith(expect.objectContaining({
      handed_over_at: '2026-10-08',
    }))
    expect(finalizeSale).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdate?.()
      await Promise.resolve()
    })

    expect(updateSale.mock.invocationCallOrder[0]).toBeLessThan(
      finalizeSale.mock.invocationCallOrder[0],
    )
  })

  it('defaults a private buyer to consumer and requires explicit agreement for shortening', () => {
    render(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )

    const consumerCheckbox = screen.getByRole('checkbox', { name: 'Käufer:in ist Verbraucher:in' })
    const shorteningCheckbox = screen.getByRole('checkbox', { name: 'Verkürzung wurde ausdrücklich vereinbart' })
    expect(consumerCheckbox).toBeChecked()
    expect(shorteningCheckbox).not.toBeChecked()
    expect(screen.getByText('Verlängerungen durch Reparaturen werden nicht erfasst.')).toBeInTheDocument()
    fireEvent.click(shorteningCheckbox)
    fireEvent.click(consumerCheckbox)
    expect(shorteningCheckbox).toBeDisabled()
  })

  it('defaults a company buyer to B2B and disables the shortening agreement', async () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: {
      ...existingSale,
      customer: { ...existingSale.customer, type: 'COMPANY' },
      buyer_is_consumer: null,
    } })
    render(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('checkbox', { name: 'Käufer:in ist Verbraucher:in' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Verkürzung wurde ausdrücklich vereinbart' })).toBeDisabled()
  })

  it('preserves the stored buyer classification when reopening an existing sale', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: {
      ...existingSale,
      buyer_is_consumer: false,
      customer: { ...existingSale.customer, type: 'PRIVATE' },
    } })
    render(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('checkbox', { name: 'Käufer:in ist Verbraucher:in' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Verkürzung wurde ausdrücklich vereinbart' })).toBeDisabled()
  })
})
