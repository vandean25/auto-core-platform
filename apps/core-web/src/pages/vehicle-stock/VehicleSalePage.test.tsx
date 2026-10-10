import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VehicleSalePage from './VehicleSalePage'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { toast } from 'sonner'

const {
  createSale,
  updateSale,
  finalizeSale,
  upsertTradeIn,
  removeTradeIn,
  calculateNova,
  resetNova,
  downloadKaufvertrag,
  usePdfDownloadMock,
} = vi.hoisted(() => ({
  createSale: vi.fn(),
  updateSale: vi.fn(),
  finalizeSale: vi.fn(),
  upsertTradeIn: vi.fn(),
  removeTradeIn: vi.fn(),
  calculateNova: vi.fn(),
  resetNova: vi.fn(),
  downloadKaufvertrag: vi.fn(),
  usePdfDownloadMock: vi.fn(),
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
vi.mock('@/hooks/usePdfDownload', () => ({
  usePdfDownload: (config: unknown) => {
    usePdfDownloadMock(config)
    return { download: downloadKaufvertrag, isLoading: false, isDownloading: false }
  },
}))

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
    asMock(vehicleStockApi.useUpsertVehicleSaleTradeIn).mockReturnValue({ mutateAsync: upsertTradeIn })
    asMock(vehicleStockApi.useRemoveVehicleSaleTradeIn).mockReturnValue({ mutateAsync: removeTradeIn })
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
      id: 'sale-1',
      data: expect.objectContaining({
        customer_id: 'buyer-1',
        sale_price: 14500,
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
      }),
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
      data: expect.objectContaining({ handed_over_at: '2026-10-08' }),
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

  it('preserves newer edits when an older autosave refreshes the sale query', async () => {
    let resolveUpdate: (() => void) | undefined
    updateSale.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveUpdate = resolve
    }))
    let renderedSale = { ...existingSale }
    asMock(vehicleStockApi.useVehicleSale).mockImplementation(() => ({ data: renderedSale }))

    const { rerender } = render(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Sale price (gross)'), { target: { value: '14500' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(750) })
    fireEvent.change(screen.getByLabelText('Vertragsdatum'), { target: { value: '2026-09-01' } })
    renderedSale = { ...renderedSale, sale_price: 14500 }
    rerender(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('Vertragsdatum')).toHaveValue('2026-09-01')

    await act(async () => {
      resolveUpdate?.()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(750)
    })
    expect(updateSale).toHaveBeenCalledTimes(2)
    expect(updateSale).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contract_concluded_at: '2026-09-01' }),
    }))
  })

  it('serializes overlapping autosaves and waits for the latest one before finalizing', async () => {
    let resolveFirstSave: (() => void) | undefined
    let resolveSecondSave: (() => void) | undefined
    updateSale
      .mockReturnValueOnce(new Promise<void>((resolve) => { resolveFirstSave = resolve }))
      .mockReturnValueOnce(new Promise<void>((resolve) => { resolveSecondSave = resolve }))
    finalizeSale.mockResolvedValueOnce({ invoice: { id: 'invoice-1' } })

    render(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Sale price (gross)'), { target: { value: '14500' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(750) })
    fireEvent.change(screen.getByLabelText('Vertragsdatum'), { target: { value: '2026-09-01' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(750) })
    const finalizeButton = screen.getByRole('button', { name: 'Finalize invoice' })
    fireEvent.click(finalizeButton)

    expect(updateSale).toHaveBeenCalledTimes(1)
    expect(finalizeSale).not.toHaveBeenCalled()
    expect(finalizeButton).toBeDisabled()

    await act(async () => {
      resolveFirstSave?.()
      await Promise.resolve()
    })
    expect(updateSale).toHaveBeenCalledTimes(2)
    expect(updateSale).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sale_price: 14500,
        contract_concluded_at: '2026-09-01',
      }),
    }))
    expect(resolveSecondSave).toBeDefined()
    expect(finalizeSale).not.toHaveBeenCalled()

    await act(async () => {
      resolveSecondSave?.()
      await vi.runAllTicks()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(finalizeButton).toBeEnabled()
    fireEvent.click(finalizeButton)
    await act(async () => { await Promise.resolve() })
    expect(finalizeSale).toHaveBeenCalledWith('sale-1')
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

describe('VehicleSalePage Kaufvertrag PDF and Garantie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: existingSale })
    asMock(vehicleStockApi.useVehicleStockDetail).mockReturnValue({ data: stockVehicle })
    asMock(vehicleStockApi.useCreateVehicleSale).mockReturnValue({ mutateAsync: createSale })
    asMock(vehicleStockApi.useUpdateVehicleSale).mockReturnValue({ mutateAsync: updateSale })
    asMock(vehicleStockApi.useFinalizeVehicleSale).mockReturnValue({ mutateAsync: finalizeSale })
    asMock(vehicleStockApi.useUpsertVehicleSaleTradeIn).mockReturnValue({ mutateAsync: upsertTradeIn })
    asMock(vehicleStockApi.useRemoveVehicleSaleTradeIn).mockReturnValue({ mutateAsync: removeTradeIn })
    updateSale.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  function renderSalePage(path = '/vehicle-stock/sales/sale-1') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('saves the Garantie duration and terms with the sale', async () => {
    renderSalePage()

    fireEvent.change(screen.getByLabelText('Garantiedauer in Monaten'), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByLabelText('Garantiebedingungen'), {
      target: { value: 'Motorschaden ausgenommen' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(updateSale).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        garantie_months: 12,
        garantie_terms: 'Motorschaden ausgenommen',
      }),
    }))
  })

  it('does not save an out-of-range Garantie duration and says which range applies', async () => {
    renderSalePage()

    fireEvent.change(screen.getByLabelText('Garantiedauer in Monaten'), {
      target: { value: '0' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(updateSale).not.toHaveBeenCalled()
    expect(screen.getByText('Bitte eine Dauer zwischen 1 und 120 Monaten angeben.')).toBeTruthy()
  })

  it('blocks the negotiated one-year period in the UI when the vehicle is too new for the handover date', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: { ...existingSale, buyer_is_consumer: true, handed_over_at: '2026-10-08T00:00:00.000Z' },
    })
    asMock(vehicleStockApi.useVehicleStockDetail).mockReturnValue({
      data: { ...stockVehicle, first_registration_date: '2026-06-01' },
    })

    renderSalePage()

    expect(screen.getByLabelText('Verkürzung wurde ausdrücklich vereinbart')).toBeDisabled()
    expect(
      screen.getByText('Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.'),
    ).toBeTruthy()
  })

  it('generates and downloads the Kaufvertrag PDF through the shared download hook', async () => {
    renderSalePage()

    const button = screen.getByRole('button', { name: 'Kaufvertrag PDF' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await act(async () => {
      await Promise.resolve()
    })

    expect(downloadKaufvertrag).toHaveBeenCalledTimes(1)
    const config = usePdfDownloadMock.mock.calls.at(-1)?.[0] as {
      postUrl: () => string
      getUrl: () => string
    }
    expect(config.postUrl()).toBe('/api/vehicle-sales/sale-1/kaufvertrag/pdf')
    expect(config.getUrl()).toBe('/api/vehicle-sales/sale-1/kaufvertrag/pdf')
  })

  it('does not download the Kaufvertrag PDF while the Garantie duration is out of range', async () => {
    renderSalePage()

    fireEvent.change(screen.getByLabelText('Garantiedauer in Monaten'), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Kaufvertrag PDF' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(downloadKaufvertrag).not.toHaveBeenCalled()
    expect(updateSale).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Bitte eine Dauer zwischen 1 und 120 Monaten angeben.')
  })

  it('clears the Garantie terms when the duration is removed, so no terms are saved without one', async () => {
    renderSalePage()

    fireEvent.change(screen.getByLabelText('Garantiedauer in Monaten'), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByLabelText('Garantiebedingungen'), {
      target: { value: 'Motorschaden ausgenommen' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })
    expect(updateSale).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        garantie_months: 12,
        garantie_terms: 'Motorschaden ausgenommen',
      }),
    }))

    fireEvent.change(screen.getByLabelText('Garantiedauer in Monaten'), {
      target: { value: '' },
    })
    expect(screen.getByLabelText('Garantiebedingungen')).toBeDisabled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(updateSale).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ garantie_months: null, garantie_terms: null }),
    }))
  })

  it('keeps the Kaufvertrag PDF action disabled until the sale has been saved', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: undefined })

    renderSalePage('/vehicle-stock/sales/new?vehicleId=vehicle-1')

    expect(screen.getByRole('button', { name: 'Kaufvertrag PDF' })).toBeDisabled()
  })
})

describe('VehicleSalePage trade-in', () => {
  const savedTradeIn = {
    id: 'purchase-1',
    purchase_number: 'VP-2026-0002',
    status: 'DRAFT',
    vin: 'TRDNB000000000001',
    make: 'Skoda',
    model: 'Octavia',
    year: 2016,
    mileage: 98000,
    first_registration_date: '2016-03-01',
    plate: null,
    color: null,
    purchase_price: '5000.00',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: { ...existingSale, trade_in_purchase: null } })
    asMock(vehicleStockApi.useVehicleStockDetail).mockReturnValue({ data: stockVehicle })
    asMock(vehicleStockApi.useCreateVehicleSale).mockReturnValue({ mutateAsync: createSale })
    asMock(vehicleStockApi.useUpdateVehicleSale).mockReturnValue({ mutateAsync: updateSale })
    asMock(vehicleStockApi.useFinalizeVehicleSale).mockReturnValue({ mutateAsync: finalizeSale })
    asMock(vehicleStockApi.useUpsertVehicleSaleTradeIn).mockReturnValue({ mutateAsync: upsertTradeIn })
    asMock(vehicleStockApi.useRemoveVehicleSaleTradeIn).mockReturnValue({ mutateAsync: removeTradeIn })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  function renderSalePage() {
    return render(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('autosaves a valid trade-in after the debounce window and shows the amount due', async () => {
    upsertTradeIn.mockResolvedValue({ ...existingSale, trade_in_purchase: null })
    renderSalePage()

    fireEvent.change(screen.getByLabelText('Allowance (EUR)'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('VIN'), { target: { value: 'trdnb000000000001' } })
    fireEvent.change(screen.getByLabelText('Make'), { target: { value: 'Skoda' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Octavia' } })
    fireEvent.change(screen.getByLabelText('Model year'), { target: { value: '2016' } })
    expect(screen.getByText(/Amount due after trade-in/)).toBeInTheDocument()
    expect(screen.getByText('€7,000.00')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(upsertTradeIn).toHaveBeenCalledTimes(1)
    expect(upsertTradeIn).toHaveBeenCalledWith({
      id: 'sale-1',
      data: expect.objectContaining({
        allowance: 5000,
        vin: 'TRDNB000000000001',
        make: 'Skoda',
        model: 'Octavia',
        year: 2016,
      }),
    })
  })

  it('does not save a trade-in whose allowance exceeds the sale price', async () => {
    renderSalePage()

    fireEvent.change(screen.getByLabelText('Allowance (EUR)'), { target: { value: '13000' } })
    fireEvent.change(screen.getByLabelText('VIN'), { target: { value: 'TRDNB000000000001' } })
    fireEvent.change(screen.getByLabelText('Make'), { target: { value: 'Skoda' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Octavia' } })
    fireEvent.change(screen.getByLabelText('Model year'), { target: { value: '2016' } })

    expect(screen.getByText('The allowance cannot exceed the sale price.')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })
    expect(upsertTradeIn).not.toHaveBeenCalled()
  })

  it('does not rewrite an unchanged saved trade-in when the sale is opened', async () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: { ...existingSale, trade_in_purchase: savedTradeIn, amount_due_preview: '7000.00' },
    })
    renderSalePage()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(upsertTradeIn).not.toHaveBeenCalled()
  })

  it('shows a saved trade-in and removes it on request', async () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: { ...existingSale, trade_in_purchase: savedTradeIn, amount_due_preview: '7000.00' },
    })
    removeTradeIn.mockResolvedValue({ ...existingSale, trade_in_purchase: null })
    renderSalePage()

    expect(screen.getByLabelText('VIN')).toHaveValue('TRDNB000000000001')
    expect(screen.getAllByText('€7,000.00').length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove trade-in' }))
    })

    expect(removeTradeIn).toHaveBeenCalledWith('sale-1')
  })

  it('saves a trade-in typed inside the autosave window before the sale is invoiced', async () => {
    upsertTradeIn.mockResolvedValue({ ...existingSale, trade_in_purchase: savedTradeIn })
    finalizeSale.mockResolvedValue({ invoice: { id: 'invoice-1' } })
    renderSalePage()

    fireEvent.change(screen.getByLabelText('Allowance (EUR)'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('VIN'), { target: { value: 'TRDNB000000000001' } })
    fireEvent.change(screen.getByLabelText('Make'), { target: { value: 'Skoda' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Octavia' } })
    fireEvent.change(screen.getByLabelText('Model year'), { target: { value: '2016' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Finalize invoice' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(upsertTradeIn).toHaveBeenCalledTimes(1)
    expect(upsertTradeIn).toHaveBeenCalledWith({
      id: 'sale-1',
      data: expect.objectContaining({ allowance: 5000, vin: 'TRDNB000000000001' }),
    })
    expect(finalizeSale).toHaveBeenCalledWith('sale-1')
    expect(upsertTradeIn.mock.invocationCallOrder[0]).toBeLessThan(finalizeSale.mock.invocationCallOrder[0])
  })

  it('stops the invoice with the reason when the trade-in on the form is incomplete', async () => {
    renderSalePage()

    fireEvent.change(screen.getByLabelText('Allowance (EUR)'), { target: { value: '5000' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Finalize invoice' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(upsertTradeIn).not.toHaveBeenCalled()
    expect(finalizeSale).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('The VIN must have 17 characters and no I, O or Q.')
  })

  it('announces the save status and the validation message to assistive technology', () => {
    renderSalePage()
    const section = screen.getByRole('region', { name: 'Trade-in' })

    fireEvent.change(within(section).getByLabelText('Allowance (EUR)'), { target: { value: '13000' } })

    expect(within(section).getByRole('status')).toBeInTheDocument()
    expect(within(section).getByText('The allowance cannot exceed the sale price.')).toHaveAttribute(
      'aria-live',
      'polite',
    )
  })
})
