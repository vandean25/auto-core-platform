import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PurchaseOrderCreate from './PurchaseOrderCreate'
import * as vendorApi from '@/api/vendors'
import * as brandApi from '@/api/brands'
import { takeQueuedPurchaseOrderCreate } from './usePurchaseOrderPendingCreate'

vi.mock('@/api/vendors')
vi.mock('@/api/brands')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const brand = { id: 1, name: 'Bosch', isVehicleMake: false, isPartManufacturer: true, logoUrl: null }
const vendor = {
  id: 'vendor-1',
  name: 'Bosch Automotive',
  email: 'bosch@example.com',
  supportedBrands: [brand],
}

describe('PurchaseOrderCreate autosave', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.clearAllMocks()
    asMock(brandApi.useBrands).mockReturnValue({ data: [brand], isLoading: false })
    asMock(vendorApi.useVendors).mockReturnValue({
      data: { data: [vendor] },
      isLoading: false,
    })
  })

  const renderPage = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/purchase-orders/new']}>
          <Routes>
            <Route path="/purchase-orders/new" element={<PurchaseOrderCreate />} />
            <Route path="/purchase-orders" element={<p>order-list</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('hands the vendor to the order list 750ms after it is selected, without creating yet', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Bosch' }))
    fireEvent.click(screen.getByText('Bosch Automotive'))

    expect(await screen.findByText('order-list', undefined, { timeout: 2000 })).toBeInTheDocument()
    expect(takeQueuedPurchaseOrderCreate()).toEqual({
      vendorId: 'vendor-1',
      vendorName: 'Bosch Automotive',
    })
  })
})
