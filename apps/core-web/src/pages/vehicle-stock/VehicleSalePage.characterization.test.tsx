import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import VehicleSalePage from './VehicleSalePage'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { deVehicleStock } from '@/test/de-vehicleStock'
import { formattedCurrencyPattern } from '@/test/format-assertions'

// Pins page behavior that the other VehicleSalePage specs leave open (AUT-671).
const {
  createSale,
  updateSale,
  finalizeSale,
  upsertTradeIn,
  removeTradeIn,
  downloadKaufvertrag,
  usePdfDownloadMock,
} = vi.hoisted(() => ({
  createSale: vi.fn(),
  updateSale: vi.fn(),
  finalizeSale: vi.fn(),
  upsertTradeIn: vi.fn(),
  removeTradeIn: vi.fn(),
  downloadKaufvertrag: vi.fn(),
  usePdfDownloadMock: vi.fn(),
}))

vi.mock('@/api/vehicle-stock')
vi.mock('@/api/nova', () => ({
  useNovaCalculate: () => ({ mutate: vi.fn(), reset: vi.fn(), data: undefined, error: null, isPending: false }),
}))
vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: ({ onChange }: { onChange: (customer: unknown) => void }) => (
    <div>
      <button type="button" onClick={() => onChange(privateBuyer)}>pick private buyer</button>
      <button type="button" onClick={() => onChange(companyBuyer)}>pick company buyer</button>
      <button type="button" onClick={() => onChange(null)}>clear buyer</button>
    </div>
  ),
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

const privateBuyer = { id: 'buyer-2', type: 'PRIVATE', first_name: 'Private', last_name: 'Buyer', email: '' }
const companyBuyer = { id: 'buyer-3', type: 'COMPANY', first_name: '', last_name: '', company_name: 'Fleet GmbH', email: '' }

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

const sale = deVehicleStock.sale
const consumerCheckboxName = sale.warranty.consumerBuyer
const shorteningCheckboxName = sale.warranty.shorteningNegotiated

function asMock(fn: unknown) {
  return fn as ReturnType<typeof vi.fn>
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderSalePage(path = '/vehicle-stock/sales/sale-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

function currentLocation() {
  return screen.getByTestId('location').textContent
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T09:00:00.000Z'))
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

describe('VehicleSalePage new sale', () => {
  beforeEach(() => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: undefined })
  })

  it('creates the sale once buyer and price are set, then replaces the URL with the new sale', async () => {
    createSale.mockResolvedValue({ id: 'sale-new' })
    renderSalePage('/vehicle-stock/sales/new?vehicleId=vehicle-1')

    expect(screen.getByLabelText(sale.contractDate)).toHaveValue('2026-10-20')
    fireEvent.click(screen.getByRole('button', { name: 'pick private buyer' }))
    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '15000' } })
    await advance(749)
    expect(createSale).not.toHaveBeenCalled()
    await advance(1)

    expect(createSale).toHaveBeenCalledTimes(1)
    expect(createSale).toHaveBeenCalledWith({
      vehicle_id: 'vehicle-1',
      customer_id: 'buyer-2',
      sale_price: 15000,
      contract_concluded_at: '2026-10-20',
      handed_over_at: undefined,
      buyer_is_consumer: true,
      gewaehrleistung_shortened_negotiated: false,
      gewaehrleistung_note: null,
      garantie_months: null,
      garantie_terms: null,
    })
    expect(currentLocation()).toBe('/vehicle-stock/sales/sale-new')
    expect(screen.getByText(sale.saveStatus.saved)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sale.downloadKaufvertrag })).toBeEnabled()
    expect(screen.getByRole('button', { name: sale.finalizeInvoice })).toBeEnabled()
  })

  it('updates the created sale on the next edit instead of creating a second one', async () => {
    createSale.mockResolvedValue({ id: 'sale-new' })
    const createdSale = {
      ...existingSale,
      id: 'sale-new',
      customer_id: 'buyer-2',
      sale_price: 15000,
      contract_concluded_at: '2026-10-20',
      customer: privateBuyer,
    }
    asMock(vehicleStockApi.useVehicleSale).mockImplementation((id: string) => ({
      data: id === 'sale-new' ? createdSale : undefined,
    }))
    renderSalePage('/vehicle-stock/sales/new?vehicleId=vehicle-1')

    fireEvent.click(screen.getByRole('button', { name: 'pick private buyer' }))
    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '15000' } })
    await advance(750)
    fireEvent.change(screen.getByLabelText(sale.warranty.note), { target: { value: 'Gebrauchtwagen' } })
    await advance(750)

    expect(createSale).toHaveBeenCalledTimes(1)
    expect(updateSale).toHaveBeenCalledTimes(1)
    expect(updateSale).toHaveBeenCalledWith({
      id: 'sale-new',
      data: {
        customer_id: 'buyer-2',
        sale_price: 15000,
        contract_concluded_at: '2026-10-20',
        handed_over_at: null,
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
        gewaehrleistung_note: 'Gebrauchtwagen',
        garantie_months: null,
        garantie_terms: null,
      },
    })
  })

  it('does not save while the buyer or the price is missing', async () => {
    renderSalePage('/vehicle-stock/sales/new?vehicleId=vehicle-1')

    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '15000' } })
    await advance(750)
    expect(createSale).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'pick private buyer' }))
    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '' } })
    await advance(750)
    expect(createSale).not.toHaveBeenCalled()
  })

  it('shows the vehicle summary, a back link to the vehicle and no status or invoice link', () => {
    renderSalePage('/vehicle-stock/sales/new?vehicleId=vehicle-1')

    expect(screen.getByRole('heading', { level: 1, name: sale.title })).toBeInTheDocument()
    expect(screen.getByText(`2018 Volkswagen Golf · ${sale.subtitleMargin}`)).toBeInTheDocument()
    expect(screen.queryByText('DRAFT')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: sale.downloadKaufvertrag })).toBeDisabled()
    expect(screen.getByRole('button', { name: sale.finalizeInvoice })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: sale.backToVehicleAria }))
    expect(currentLocation()).toBe('/vehicle-stock/vehicle-1')
  })

  it('falls back to the generic subtitle and the stock list without a vehicle', () => {
    asMock(vehicleStockApi.useVehicleStockDetail).mockReturnValue({ data: undefined })
    renderSalePage('/vehicle-stock/sales/new')

    expect(screen.getByText(sale.subtitleFallback)).toBeInTheDocument()
    expect(screen.queryByLabelText('NoVA-Netto-Preis')).not.toBeInTheDocument()
    expect(screen.getByText(sale.preview.costBasis).nextElementSibling).toHaveTextContent('—')
    expect(screen.getByText(sale.preview.marginVat).nextElementSibling).toHaveTextContent('—')

    fireEvent.click(screen.getByRole('button', { name: sale.backAria }))
    expect(currentLocation()).toBe('/vehicle-stock')
  })
})

describe('VehicleSalePage buyer and Gewährleistung fields', () => {
  it('classifies a picked company buyer as B2B and clears a ticked shortening', async () => {
    renderSalePage()

    fireEvent.click(screen.getByRole('checkbox', { name: shorteningCheckboxName }))
    expect(screen.getByRole('checkbox', { name: shorteningCheckboxName })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'pick company buyer' }))

    expect(screen.getByRole('checkbox', { name: consumerCheckboxName })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: shorteningCheckboxName })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: shorteningCheckboxName })).toBeDisabled()
    await advance(750)
    expect(updateSale).toHaveBeenCalledWith({
      id: 'sale-1',
      data: expect.objectContaining({
        customer_id: 'buyer-3',
        buyer_is_consumer: false,
        gewaehrleistung_shortened_negotiated: false,
      }),
    })
  })

  it('classifies a picked private buyer as consumer again', () => {
    renderSalePage()

    fireEvent.click(screen.getByRole('button', { name: 'pick company buyer' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick private buyer' }))

    expect(screen.getByRole('checkbox', { name: consumerCheckboxName })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: shorteningCheckboxName })).toBeEnabled()
  })

  it('keeps the classification and the stored buyer when the buyer is cleared', async () => {
    renderSalePage()

    fireEvent.click(screen.getByRole('button', { name: 'clear buyer' }))
    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '14000' } })
    await advance(750)

    expect(screen.getByRole('checkbox', { name: consumerCheckboxName })).toBeChecked()
    expect(updateSale).toHaveBeenCalledWith({
      id: 'sale-1',
      data: expect.objectContaining({ customer_id: 'buyer-1', sale_price: 14000, buyer_is_consumer: true }),
    })
  })

  it('unticks the shortening when the buyer is marked as not a consumer', async () => {
    renderSalePage()

    fireEvent.click(screen.getByRole('checkbox', { name: shorteningCheckboxName }))
    fireEvent.click(screen.getByRole('checkbox', { name: consumerCheckboxName }))
    fireEvent.click(screen.getByRole('checkbox', { name: consumerCheckboxName }))

    expect(screen.getByRole('checkbox', { name: shorteningCheckboxName })).not.toBeChecked()
    await advance(750)
    expect(updateSale).not.toHaveBeenCalled()
  })

  it('sends a ticked shortening only for a consumer buyer and saves the warranty note', async () => {
    renderSalePage()

    fireEvent.click(screen.getByRole('checkbox', { name: shorteningCheckboxName }))
    fireEvent.change(screen.getByLabelText(sale.warranty.note), { target: { value: 'Ohne Batterie' } })
    await advance(750)

    expect(updateSale).toHaveBeenCalledWith({
      id: 'sale-1',
      data: expect.objectContaining({ gewaehrleistung_shortened_negotiated: true, gewaehrleistung_note: 'Ohne Batterie' }),
    })
  })

  it('hydrates the stored dates, warranty note and Garantie from the sale', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: {
        ...existingSale,
        sale_price: '12500.00',
        contract_concluded_at: '2026-09-30T00:00:00.000Z',
        handed_over_at: '2026-10-02T00:00:00.000Z',
        gewaehrleistung_note: 'Ohne Batterie',
        garantie_months: 24,
        garantie_terms: 'Nur Motor',
      },
    })
    renderSalePage()

    expect(screen.getByLabelText(sale.salePriceGross)).toHaveValue(12500)
    expect(screen.getByLabelText(sale.contractDate)).toHaveValue('2026-09-30')
    expect(screen.getByLabelText(sale.handoverDate)).toHaveValue('2026-10-02')
    expect(screen.getByLabelText(sale.warranty.note)).toHaveValue('Ohne Batterie')
    expect(screen.getByLabelText(sale.warranty.monthsAria)).toHaveValue(24)
    expect(screen.getByLabelText(sale.warranty.terms)).toHaveValue('Nur Motor')
    expect(screen.getByLabelText(sale.warranty.terms)).toBeEnabled()
  })
})

describe('VehicleSalePage save status', () => {
  it('shows saving while the autosave runs and disables the header actions', async () => {
    let resolveUpdate: () => void = () => undefined
    updateSale.mockReturnValueOnce(new Promise<void>((resolve) => { resolveUpdate = resolve }))
    renderSalePage()

    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '14000' } })
    await advance(750)

    expect(screen.getByText(sale.saveStatus.saving)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sale.downloadKaufvertrag })).toBeDisabled()
    expect(screen.getByRole('button', { name: sale.finalizeInvoice })).toBeDisabled()

    await act(async () => {
      resolveUpdate()
      await Promise.resolve()
    })
    expect(screen.getByText(sale.saveStatus.saved)).toBeInTheDocument()
    expect(screen.queryByText(sale.saveStatus.saving)).not.toBeInTheDocument()
  })

  it('reports a failed autosave with the fallback message', async () => {
    updateSale.mockRejectedValueOnce(new Error('network down'))
    renderSalePage()

    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '14000' } })
    await advance(750)

    expect(toast.error).toHaveBeenCalledWith(sale.saveFailed)
    expect(screen.getByText(sale.saveStatus.error)).toBeInTheDocument()
  })
})

describe('VehicleSalePage finalize', () => {
  it('confirms the invoice and opens it', async () => {
    finalizeSale.mockResolvedValue({ invoice: { id: 'invoice-9' } })
    renderSalePage()

    fireEvent.click(screen.getByRole('button', { name: sale.finalizeInvoice }))
    await advance(0)

    expect(updateSale).not.toHaveBeenCalled()
    expect(finalizeSale).toHaveBeenCalledWith('sale-1')
    expect(toast.success).toHaveBeenCalledWith(sale.invoicedSuccess)
    expect(currentLocation()).toBe('/sales/invoices/invoice-9')
  })

  it('returns to the stock list when finalizing gives no invoice', async () => {
    finalizeSale.mockResolvedValue({ invoice: null })
    renderSalePage()

    fireEvent.click(screen.getByRole('button', { name: sale.finalizeInvoice }))
    await advance(0)

    expect(currentLocation()).toBe('/vehicle-stock')
  })

  it('cancels a pending autosave and saves its facts once before finalizing', async () => {
    finalizeSale.mockResolvedValue({ invoice: { id: 'invoice-9' } })
    renderSalePage()

    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '14000' } })
    fireEvent.click(screen.getByRole('button', { name: sale.finalizeInvoice }))
    await advance(750)

    expect(updateSale).toHaveBeenCalledTimes(1)
    expect(updateSale).toHaveBeenCalledWith({ id: 'sale-1', data: expect.objectContaining({ sale_price: 14000 }) })
    expect(finalizeSale).toHaveBeenCalledTimes(1)
  })

  it('reports a failed finalize with the fallback message and re-enables the action', async () => {
    finalizeSale.mockRejectedValue(new Error('boom'))
    renderSalePage()

    fireEvent.click(screen.getByRole('button', { name: sale.finalizeInvoice }))
    await advance(0)

    expect(toast.error).toHaveBeenCalledWith(sale.finalizeFailed)
    expect(screen.getByRole('button', { name: sale.finalizeInvoice })).toBeEnabled()
    expect(currentLocation()).toBe('/vehicle-stock/sales/sale-1')
  })
})

describe('VehicleSalePage Kaufvertrag download', () => {
  it('names the PDF after the sale number and checks the generation error on the sale', () => {
    renderSalePage()

    const config = usePdfDownloadMock.mock.calls.at(-1)?.[0] as {
      filename: () => string
      checkGenerationFailed: () => unknown
      messages: { success: string; errorFallback: string }
    }
    expect(config.filename()).toBe('kaufvertrag-vs_2026_0001.pdf')
    config.checkGenerationFailed()
    expect(vehicleStockApi.fetchVehicleSaleKaufvertragGenerationError).toHaveBeenCalledWith('sale-1')
    expect(config.messages).toEqual({ success: sale.pdf.success, errorFallback: sale.pdf.errorFallback })
  })

  it('saves an edit still inside the autosave window once, then downloads', async () => {
    renderSalePage()

    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '14000' } })
    fireEvent.click(screen.getByRole('button', { name: sale.downloadKaufvertrag }))
    await advance(750)

    expect(updateSale).toHaveBeenCalledTimes(1)
    expect(updateSale).toHaveBeenCalledWith({ id: 'sale-1', data: expect.objectContaining({ sale_price: 14000 }) })
    expect(downloadKaufvertrag).toHaveBeenCalledTimes(1)
    expect(updateSale.mock.invocationCallOrder[0]).toBeLessThan(downloadKaufvertrag.mock.invocationCallOrder[0])
  })

  it('does not download while the sale price is missing', async () => {
    renderSalePage()

    fireEvent.change(screen.getByLabelText(sale.salePriceGross), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: sale.downloadKaufvertrag }))
    await advance(0)

    expect(downloadKaufvertrag).not.toHaveBeenCalled()
    expect(updateSale).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(sale.saveFailed)
  })
})

describe('VehicleSalePage after the draft', () => {
  const invoicedSale = {
    ...existingSale,
    status: 'INVOICED',
    garantie_months: 12,
    invoice: { id: 'invoice-1', invoice_number: null },
  }

  it('locks the form and the invoice action but still downloads without saving', async () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: invoicedSale })
    renderSalePage()

    for (const label of [
      sale.salePriceGross,
      sale.contractDate,
      sale.handoverDate,
      sale.warranty.note,
      sale.warranty.monthsAria,
      sale.warranty.terms,
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled()
    }
    expect(screen.getByRole('checkbox', { name: consumerCheckboxName })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: shorteningCheckboxName })).toBeDisabled()
    expect(screen.getByRole('button', { name: sale.finalizeInvoice })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: sale.downloadKaufvertrag }))
    await advance(0)

    expect(updateSale).not.toHaveBeenCalled()
    expect(downloadKaufvertrag).toHaveBeenCalledTimes(1)
  })

  it('shows the status and links the invoice generically when it has no number yet', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: invoicedSale })
    renderSalePage()

    expect(screen.getByText('INVOICED')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: sale.openInvoice })).toHaveAttribute('href', '/sales/invoices/invoice-1')
  })

  it('disables the Kaufvertrag download on a cancelled sale', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: { ...existingSale, status: 'CANCELLED' } })
    renderSalePage()

    expect(screen.getByRole('button', { name: sale.downloadKaufvertrag })).toBeDisabled()
    expect(screen.getByRole('button', { name: sale.finalizeInvoice })).toBeDisabled()
  })
})

describe('VehicleSalePage previews', () => {
  it('prefers the sale cost preview over the vehicle cost basis and shows the margin VAT', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: { ...existingSale, cost_basis_preview: '9500.00', margin_vat_preview: '416.67' },
    })
    renderSalePage()

    expect(screen.getByText(sale.preview.costBasis).nextElementSibling).toHaveTextContent(formattedCurrencyPattern(9500))
    expect(screen.getByText(sale.preview.marginVat).nextElementSibling).toHaveTextContent(formattedCurrencyPattern(416.67))
    expect(screen.getByText(sale.preview.taxMode).nextElementSibling).toHaveTextContent(sale.preview.taxModeMarginScheme)
  })

  it('falls back to the vehicle cost basis and a dash for a missing margin VAT', () => {
    renderSalePage()

    expect(screen.getByText(sale.preview.costBasis).nextElementSibling).toHaveTextContent(formattedCurrencyPattern(10000))
    expect(screen.getByText(sale.preview.marginVat).nextElementSibling).toHaveTextContent('—')
  })

  it('summarizes a saved trade-in with its allowance and the amount due', () => {
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({
      data: {
        ...existingSale,
        trade_in_purchase: {
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
        },
        amount_due_preview: null,
      },
    })
    renderSalePage()

    expect(screen.getByText('2016 Skoda Octavia')).toBeInTheDocument()
    expect(screen.getByText(sale.tradeIn.allowance).nextElementSibling).toHaveTextContent(formattedCurrencyPattern(5000))
    expect(screen.getByText(sale.tradeIn.amountDue).nextElementSibling).toHaveTextContent('—')
  })

  it('shows no trade-in summary without a saved trade-in', () => {
    renderSalePage()

    expect(screen.queryByText(sale.tradeIn.allowance)).not.toBeInTheDocument()
  })
})
