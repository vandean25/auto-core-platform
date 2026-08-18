import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PurchaseOrderCreate from './PurchaseOrderCreate'
import * as vendorApi from '@/api/vendors'
import * as brandApi from '@/api/brands'
import * as purchaseOrderApi from '@/api/purchase-orders'

vi.mock('@/api/vendors')
vi.mock('@/api/brands')
vi.mock('@/api/purchase-orders')
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
        <MemoryRouter>
          <PurchaseOrderCreate />
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('auto-creates a draft PO 750ms after a vendor is selected', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ id: 'po-1' })
    asMock(purchaseOrderApi.useCreatePO).mockReturnValue({
      mutateAsync,
      isPending: false,
    })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Bosch' }))
    fireEvent.click(screen.getByText('Bosch Automotive'))

    await waitFor(
      () => {
        expect(mutateAsync).toHaveBeenCalledWith({ vendorId: 'vendor-1', items: [] })
      },
      { timeout: 2000 },
    )

    expect(await screen.findByText(/Saving|All changes saved/)).toBeInTheDocument()
  })
})
