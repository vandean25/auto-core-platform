import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import VehicleSalePage from './VehicleSalePage'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { fetchWithAuth } from '@/api/client'
import { triggerBlobDownload } from '@/lib/download'

// Only the HTTP layer and the file save are stubbed. The page, the shared
// usePdfDownload hook and the async PDF polling run for real.
vi.mock('@/api/vehicle-stock')
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))
vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))
vi.mock('@/api/nova', () => ({
  useNovaCalculate: () => ({ mutate: vi.fn(), reset: vi.fn(), data: undefined, error: null, isPending: false }),
}))
vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: () => <div>Selected buyer</div>,
}))
vi.mock('@/components/status/StatusBadge', () => ({ StatusBadge: () => null }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 'toast-1'), dismiss: vi.fn() },
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

const PDF_URL = '/api/vehicle-sales/sale-1/kaufvertrag/pdf'
const PDF_BYTES = '%PDF-1.4'

function asMock(fn: unknown) {
  return fn as ReturnType<typeof vi.fn>
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function pdfResponse() {
  return new Response(PDF_BYTES, {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  })
}

/** The PDF requests in the order the page sent them, as `METHOD url`. */
function pdfRequests(): string[] {
  return vi
    .mocked(fetchWithAuth)
    .mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
}

/** POST answers "enqueued". Each GET answers the next queued response, then repeats the last one. */
function mockPdfRequests(getResponses: Array<() => Response>) {
  let getCalls = 0
  vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
    if (url !== PDF_URL) throw new Error(`Unexpected request: ${url}`)
    if (init?.method === 'POST') {
      return jsonResponse(201, {
        mode: 'enqueued',
        saleId: 'sale-1',
        bucket: null,
        key: null,
        generatedAt: null,
        taskId: 'task-1',
      })
    }
    const respond = getResponses[Math.min(getCalls, getResponses.length - 1)]
    getCalls += 1
    return respond()
  })
}

function renderSalePage() {
  return render(
    <MemoryRouter initialEntries={['/vehicle-stock/sales/sale-1']}>
      <Routes>
        <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('VehicleSalePage Kaufvertrag download through the real hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(vehicleStockApi.useVehicleSale).mockReturnValue({ data: existingSale })
    asMock(vehicleStockApi.useVehicleStockDetail).mockReturnValue({ data: stockVehicle })
    asMock(vehicleStockApi.useCreateVehicleSale).mockReturnValue({ mutateAsync: vi.fn() })
    asMock(vehicleStockApi.useUpdateVehicleSale).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
    })
    asMock(vehicleStockApi.useFinalizeVehicleSale).mockReturnValue({ mutateAsync: vi.fn() })
    asMock(vehicleStockApi.useUpsertVehicleSaleTradeIn).mockReturnValue({ mutateAsync: vi.fn() })
    asMock(vehicleStockApi.useRemoveVehicleSaleTradeIn).mockReturnValue({ mutateAsync: vi.fn() })
    asMock(vehicleStockApi.fetchVehicleSaleKaufvertragGenerationError).mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
  })

  it('posts, waits through the not-ready response, then downloads the archived PDF', async () => {
    mockPdfRequests([
      () => jsonResponse(404, { message: 'Kaufvertrag PDF is not generated yet' }),
      pdfResponse,
    ])
    renderSalePage()

    fireEvent.click(screen.getByRole('button', { name: 'Kaufvertrag PDF' }))

    await waitFor(() => expect(pdfRequests()).toHaveLength(2))
    expect(triggerBlobDownload).not.toHaveBeenCalled()

    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1), {
      timeout: 5_000,
    })
    const [blob, filename] = vi.mocked(triggerBlobDownload).mock.calls[0]
    expect((blob as Blob).size).toBe(PDF_BYTES.length)
    expect(filename).toBe('kaufvertrag-vs_2026_0001.pdf')
    expect(pdfRequests()).toEqual([`POST ${PDF_URL}`, `GET ${PDF_URL}`, `GET ${PDF_URL}`])
    expect(toast.success).toHaveBeenCalledWith(
      'Kaufvertrag-PDF heruntergeladen',
      expect.objectContaining({ id: 'toast-1' }),
    )
  }, 15_000)

  it('stops with the generation error recorded on the sale and downloads nothing', async () => {
    asMock(vehicleStockApi.fetchVehicleSaleKaufvertragGenerationError).mockResolvedValue(
      'Render timeout',
    )
    mockPdfRequests([pdfResponse])
    renderSalePage()

    fireEvent.click(screen.getByRole('button', { name: 'Kaufvertrag PDF' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Render timeout',
        expect.objectContaining({ id: 'toast-1' }),
      ),
    )
    expect(triggerBlobDownload).not.toHaveBeenCalled()
    expect(pdfRequests()).toEqual([`POST ${PDF_URL}`])
  })
})
