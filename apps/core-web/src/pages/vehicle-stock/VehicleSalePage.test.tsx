import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VehicleSalePage from './VehicleSalePage'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'
import { formatStatusLabel } from '@/lib/i18n/enum-labels'
import { formattedCurrencyPattern } from '@/test/format-assertions'
import { toast } from 'sonner'
import { deVehicleStock } from '@/test/de-vehicleStock'

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
vi.mock('@/components/status/StatusBadge', () => ({
  StatusBadge: ({ status, label }: { status: string; label?: string }) => <span>{label ?? status}</span>,
}))
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

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.salePriceGross), {
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

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.handoverDate), {
      target: { value: '2026-10-08' },
    })
    fireEvent.click(screen.getByRole('button', { name: deVehicleStock.sale.finalizeInvoice }))

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

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.salePriceGross), { target: { value: '14500' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(750) })
    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.contractDate), { target: { value: '2026-09-01' } })
    renderedSale = { ...renderedSale, sale_price: 14500 }
    rerender(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByLabelText(deVehicleStock.sale.contractDate)).toHaveValue('2026-09-01')

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

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.salePriceGross), { target: { value: '14500' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(750) })
    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.contractDate), { target: { value: '2026-09-01' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(750) })
    const finalizeButton = screen.getByRole('button', { name: deVehicleStock.sale.finalizeInvoice })
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
    const shorteningCheckbox = screen.getByRole('checkbox', { name: deVehicleStock.sale.warranty.shorteningNegotiated })
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
    expect(screen.getByRole('checkbox', { name: deVehicleStock.sale.warranty.shorteningNegotiated })).toBeDisabled()
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
    expect(screen.getByRole('checkbox', { name: deVehicleStock.sale.warranty.shorteningNegotiated })).toBeDisabled()
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

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.warranty.monthsAria), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.warranty.terms), {
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

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.warranty.monthsAria), {
      target: { value: '0' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(updateSale).not.toHaveBeenCalled()
    expect(screen.getByText(deVehicleStock.sale.warranty.monthsError)).toBeTruthy()
  })

  it('links the Garantie duration error to its input', () => {
    renderSalePage()
    const input = screen.getByLabelText(deVehicleStock.sale.warranty.monthsAria)
    expectFieldValid(input)

    fireEvent.change(input, { target: { value: '0' } })

    expectFieldErrorLinked(input, deVehicleStock.sale.warranty.monthsError)
    expect(screen.getByText(deVehicleStock.sale.warranty.monthsError)).toHaveAttribute('role', 'alert')
  })

  it('blocks the negotiated one-year period in the UI when the vehicle is too new for the handover date', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: { ...existingSale, buyer_is_consumer: true, handed_over_at: '2026-10-08T00:00:00.000Z' },
    })
    asMock(vehicleStockApi.useVehicleStockDetail).mockReturnValue({
      data: { ...stockVehicle, first_registration_date: '2026-06-01' },
    })

    renderSalePage()

    expect(screen.getByLabelText(deVehicleStock.sale.warranty.shorteningNegotiated)).toBeDisabled()
    expect(
      screen.getByText('Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.'),
    ).toBeTruthy()
    expect(screen.getByLabelText(deVehicleStock.sale.warranty.shorteningNegotiated)).toHaveAccessibleDescription(
      'Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.',
    )
    expect(screen.getByLabelText(deVehicleStock.sale.warranty.shorteningNegotiated)).toHaveAttribute('aria-invalid', 'false')
  })

  it('marks the shortening checkbox invalid when it is ticked and its reason applies', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: {
        ...existingSale,
        buyer_is_consumer: true,
        handed_over_at: '2026-10-08T00:00:00.000Z',
        gewaehrleistung_shortened_negotiated: true,
      },
    })
    asMock(vehicleStockApi.useVehicleStockDetail).mockReturnValue({
      data: { ...stockVehicle, first_registration_date: '2026-06-01' },
    })

    renderSalePage()

    const checkbox = screen.getByLabelText(deVehicleStock.sale.warranty.shorteningNegotiated)
    expect(checkbox).toBeChecked()
    expect(checkbox).toBeEnabled()
    expect(checkbox).toHaveAttribute('aria-invalid', 'true')
    expect(checkbox).toHaveAccessibleDescription('Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.')
  })

  it('generates and downloads the Kaufvertrag PDF through the shared download hook', async () => {
    renderSalePage()

    const button = screen.getByRole('button', { name: deVehicleStock.sale.downloadKaufvertrag })
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

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.warranty.monthsAria), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('button', { name: deVehicleStock.sale.downloadKaufvertrag }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(downloadKaufvertrag).not.toHaveBeenCalled()
    expect(updateSale).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(deVehicleStock.sale.saveFailed)
  })

  it('clears the Garantie terms when the duration is removed, so no terms are saved without one', async () => {
    renderSalePage()

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.warranty.monthsAria), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.warranty.terms), {
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

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.warranty.monthsAria), {
      target: { value: '' },
    })
    expect(screen.getByLabelText(deVehicleStock.sale.warranty.terms)).toBeDisabled()
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

    expect(screen.getByRole('button', { name: deVehicleStock.sale.downloadKaufvertrag })).toBeDisabled()
  })
})

describe('VehicleSalePage trade-in', () => {
  const ti = deVehicleStock.sale.tradeIn
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

    fireEvent.change(screen.getByLabelText(ti.allowanceLabel), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText(ti.vin), { target: { value: 'trdnb000000000001' } })
    fireEvent.change(screen.getByLabelText(ti.make), { target: { value: 'Skoda' } })
    fireEvent.change(screen.getByLabelText(ti.model), { target: { value: 'Octavia' } })
    fireEvent.change(screen.getByLabelText(ti.year), { target: { value: '2016' } })
    expect(screen.getByText(new RegExp(ti.amountDue))).toBeInTheDocument()
    expect(screen.getByText(formattedCurrencyPattern(7000))).toBeInTheDocument()

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

    fireEvent.change(screen.getByLabelText(ti.allowanceLabel), { target: { value: '13000' } })
    fireEvent.change(screen.getByLabelText(ti.vin), { target: { value: 'TRDNB000000000001' } })
    fireEvent.change(screen.getByLabelText(ti.make), { target: { value: 'Skoda' } })
    fireEvent.change(screen.getByLabelText(ti.model), { target: { value: 'Octavia' } })
    fireEvent.change(screen.getByLabelText(ti.year), { target: { value: '2016' } })

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

    expect(screen.getByLabelText(ti.vin)).toHaveValue('TRDNB000000000001')
    expect(screen.getAllByText(formattedCurrencyPattern(7000)).length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: ti.remove }))
    })

    expect(removeTradeIn).toHaveBeenCalledWith('sale-1')
  })

  it('saves a trade-in typed inside the autosave window before the sale is invoiced', async () => {
    upsertTradeIn.mockResolvedValue({ ...existingSale, trade_in_purchase: savedTradeIn })
    finalizeSale.mockResolvedValue({ invoice: { id: 'invoice-1' } })
    renderSalePage()

    fireEvent.change(screen.getByLabelText(ti.allowanceLabel), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText(ti.vin), { target: { value: 'TRDNB000000000001' } })
    fireEvent.change(screen.getByLabelText(ti.make), { target: { value: 'Skoda' } })
    fireEvent.change(screen.getByLabelText(ti.model), { target: { value: 'Octavia' } })
    fireEvent.change(screen.getByLabelText(ti.year), { target: { value: '2016' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: deVehicleStock.sale.finalizeInvoice }))
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

    fireEvent.change(screen.getByLabelText(ti.allowanceLabel), { target: { value: '5000' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: deVehicleStock.sale.finalizeInvoice }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(upsertTradeIn).not.toHaveBeenCalled()
    expect(finalizeSale).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(deVehicleStock.sale.finalizeFailed)
  })

  it('waits for an in-flight trade-in removal before finalizing, instead of saving the removed form', async () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: { ...existingSale, trade_in_purchase: savedTradeIn, amount_due_preview: '7000.00' },
    })
    let settleRemoval: (value: unknown) => void = () => undefined
    removeTradeIn.mockImplementationOnce(
      () => new Promise((resolve) => {
        settleRemoval = resolve
      }),
    )
    finalizeSale.mockResolvedValue({ invoice: { id: 'invoice-1' } })
    renderSalePage()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: ti.remove }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: deVehicleStock.sale.finalizeInvoice }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(finalizeSale).not.toHaveBeenCalled()

    await act(async () => {
      settleRemoval({ ...existingSale, trade_in_purchase: null })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(upsertTradeIn).not.toHaveBeenCalled()
    expect(removeTradeIn).toHaveBeenCalledWith('sale-1')
    expect(finalizeSale).toHaveBeenCalledWith('sale-1')
    expect(removeTradeIn.mock.invocationCallOrder[0]).toBeLessThan(finalizeSale.mock.invocationCallOrder[0])
  })

  it('stops finalize when the removal it waited for fails, so the trade-in is not invoiced unseen', async () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: { ...existingSale, trade_in_purchase: savedTradeIn, amount_due_preview: '7000.00' },
    })
    let failRemoval: (reason: unknown) => void = () => undefined
    removeTradeIn.mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        failRemoval = reject
      }),
    )
    renderSalePage()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: ti.remove }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: deVehicleStock.sale.finalizeInvoice }))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      failRemoval(new Error('Trade-in is locked'))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(finalizeSale).not.toHaveBeenCalled()
    expect(upsertTradeIn).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(deVehicleStock.sale.finalizeFailed)
  })

  it('announces the save status and the validation message to assistive technology', () => {
    renderSalePage()
    const section = screen.getByRole('region', { name: ti.title })

    fireEvent.change(within(section).getByLabelText(ti.allowanceLabel), { target: { value: '13000' } })

    expect(within(section).getByRole('status')).toBeInTheDocument()
    expect(within(section).getByText('The allowance cannot exceed the sale price.')).toHaveAttribute(
      'aria-live',
      'polite',
    )
  })

  it('marks the trade-in field behind the validation message as invalid', () => {
    renderSalePage()
    const section = screen.getByRole('region', { name: ti.title })
    const allowance = within(section).getByLabelText(ti.allowanceLabel)

    fireEvent.change(allowance, { target: { value: '13000' } })

    expectFieldErrorLinked(allowance, 'The allowance cannot exceed the sale price.')
    expectFieldValid(within(section).getByLabelText(ti.vin))
  })
})

describe('VehicleSalePage Gewährleistung after invoicing', () => {
  const invoicedSale = {
    ...existingSale,
    status: 'INVOICED',
    contract_concluded_at: '2026-10-01',
    handed_over_at: '2026-10-08',
    buyer_is_consumer: true,
    gewaehrleistung_ends_on: '2028-10-08',
    presumption_ends_on: '2027-10-08',
    gewaehrleistung_status: 'ACTIVE',
    gewaehrleistung_ends_on_expired: false,
    presumption_ends_on_expired: false,
    invoice: { id: 'invoice-1', invoice_number: 'RE-2026-1001', tax_mode: 'MARGIN_SCHEME' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
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

  it('keeps the Basisfrist and Vermutungsfrist end dates and the badge on the invoiced sale', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: invoicedSale })
    renderSalePage()

    expect(screen.getByText('Basisfrist bis 08.10.2028')).toBeInTheDocument()
    expect(screen.getByText('Vermutungsfrist bis 08.10.2027')).toBeInTheDocument()
    expect(screen.getByText(formatStatusLabel('GEWAEHRLEISTUNG_ACTIVE'))).toBeInTheDocument()
  })

  it('links the invoiced sale to its finalized invoice by invoice number', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: invoicedSale })
    renderSalePage()

    expect(screen.getByRole('link', { name: 'Rechnung RE-2026-1001' })).toHaveAttribute(
      'href',
      '/sales/invoices/invoice-1',
    )
  })

  it('marks an expired Basisfrist on the invoiced sale', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: {
      ...invoicedSale,
      gewaehrleistung_ends_on: '2026-10-01',
      gewaehrleistung_status: 'EXPIRED',
      gewaehrleistung_ends_on_expired: true,
    } })
    renderSalePage()

    expect(within(screen.getByText('Basisfrist bis 01.10.2026')).getByText('Abgelaufen')).toBeInTheDocument()
  })

  it('marks an expired Vermutungsfrist on its own line while the Basisfrist still runs', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: {
      ...invoicedSale,
      presumption_ends_on: '2026-10-01',
      presumption_ends_on_expired: true,
    } })
    renderSalePage()

    expect(within(screen.getByText('Vermutungsfrist bis 01.10.2026')).getByText('Abgelaufen')).toBeInTheDocument()
    expect(screen.getByText(formatStatusLabel('GEWAEHRLEISTUNG_ACTIVE'))).toBeInTheDocument()
    expect(screen.getAllByText('Abgelaufen')).toHaveLength(1)
  })

  it('shows neither Gewährleistung dates nor an invoice link on a draft without a snapshot', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: existingSale })
    renderSalePage()

    expect(screen.queryByText(/Basisfrist bis/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Rechnung/ })).not.toBeInTheDocument()
  })
})

describe('VehicleSalePage Gewährleistung save feedback', () => {
  const shorteningMessage = 'Für die Verkürzung ist das Datum der Erstzulassung erforderlich.'
  const shorteningCheckboxName = deVehicleStock.sale.warranty.shorteningNegotiated

  function saveError(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, data: { statusCode: status, message, code } })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
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

  function renderSalePage() {
    return render(
      <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
        <Routes>
          <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('does not resend an unchanged sale whose stored dates come back as timestamps', async () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: {
        ...existingSale,
        buyer_is_consumer: true,
        contract_concluded_at: '2026-10-01T00:00:00.000Z',
        handed_over_at: '2026-10-08T00:00:00.000Z',
      },
    })
    renderSalePage()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(updateSale).not.toHaveBeenCalled()
    expect(screen.queryByText('Saving...')).not.toBeInTheDocument()
  })

  it('shows the refused shortening on the Verkürzung checkbox with the backend message', async () => {
    updateSale.mockRejectedValueOnce(
      saveError(422, 'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED', shorteningMessage),
    )
    renderSalePage()

    fireEvent.click(screen.getByRole('checkbox', { name: shorteningCheckboxName }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    const checkbox = screen.getByRole('checkbox', { name: shorteningCheckboxName })
    expectFieldErrorLinked(checkbox, shorteningMessage)
    expect(screen.getByRole('alert')).toHaveTextContent(shorteningMessage)
    expect(screen.getByText(deVehicleStock.sale.saveStatus.error)).toBeInTheDocument()
    expect(screen.queryByText('Saving...')).not.toBeInTheDocument()
  })

  it('clears the inline shortening error once the user changes the checkbox', async () => {
    updateSale.mockRejectedValueOnce(
      saveError(422, 'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED', shorteningMessage),
    )
    renderSalePage()

    fireEvent.click(screen.getByRole('checkbox', { name: shorteningCheckboxName }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })
    expect(screen.getByText(shorteningMessage)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: shorteningCheckboxName }))

    expect(screen.queryByText(shorteningMessage)).not.toBeInTheDocument()
    expectFieldValid(screen.getByRole('checkbox', { name: shorteningCheckboxName }))
  })

  it('clears the inline shortening error after a later save succeeds', async () => {
    updateSale.mockRejectedValueOnce(
      saveError(422, 'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW', 'Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.'),
    )
    renderSalePage()

    fireEvent.click(screen.getByRole('checkbox', { name: shorteningCheckboxName }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })
    expect(screen.getByText('Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.warranty.note), { target: { value: 'Gebrauchtwagen' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(screen.queryByText('Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.')).not.toBeInTheDocument()
    expect(screen.getByText(deVehicleStock.sale.saveStatus.saved)).toBeInTheDocument()
  })

  it('shows a shortening refusal from finalizing on the checkbox too', async () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: { ...existingSale, buyer_is_consumer: true, gewaehrleistung_shortened_negotiated: true },
    })
    finalizeSale.mockRejectedValueOnce(
      saveError(422, 'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED', shorteningMessage),
    )
    renderSalePage()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: deVehicleStock.sale.finalizeInvoice }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expectFieldErrorLinked(screen.getByRole('checkbox', { name: shorteningCheckboxName }), shorteningMessage)
    expect(toast.error).toHaveBeenCalledWith(shorteningMessage)
  })

  it('keeps other sale save failures out of the Verkürzung field', async () => {
    updateSale.mockRejectedValueOnce(
      saveError(422, 'GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE', 'Für Verträge vor dem 01.01.2022 ist keine Regel hinterlegt.'),
    )
    renderSalePage()

    fireEvent.change(screen.getByLabelText(deVehicleStock.sale.salePriceGross), { target: { value: '14500' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(toast.error).toHaveBeenCalledWith('Für Verträge vor dem 01.01.2022 ist keine Regel hinterlegt.')
    expectFieldValid(screen.getByRole('checkbox', { name: shorteningCheckboxName }))
    expect(screen.getByText(deVehicleStock.sale.saveStatus.error)).toBeInTheDocument()
  })
})
