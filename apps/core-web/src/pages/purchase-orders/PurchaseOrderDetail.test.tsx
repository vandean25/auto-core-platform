import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PurchaseOrderDetail from './PurchaseOrderDetail'
import * as purchaseOrderApi from '@/api/purchase-orders'
import * as inventoryApi from '@/api/inventory'
import * as purchaseInvoiceApi from '@/api/usePurchaseInvoices'

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

vi.mock('@/api/purchase-orders')
vi.mock('@/api/inventory')
vi.mock('@/api/usePurchaseInvoices')
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return {
    ...actual,
    useParams: () => ({ id: 'po-1' }),
    useNavigate: () => vi.fn(),
  }
})
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    promise: vi.fn((promise: Promise<unknown>) => promise),
  },
}))

const draftPurchaseOrder = {
  id: 'po-1',
  vendor_id: 'vendor-1',
  order_number: 'PO-2026-0001',
  status: 'DRAFT' as const,
  createdAt: '2026-08-18T00:00:00.000Z',
  vendor: {
    id: 'vendor-1',
    name: 'Bosch Automotive',
    supportedBrands: [{ id: 1, name: 'Bosch' }],
  },
  items: [
    {
      id: 'item-1',
      catalog_item_id: 'catalog-1',
      catalog_item: { sku: 'BRK-001', name: 'Brake pads' },
      quantity: 1,
      quantity_received: 0,
      unit_cost: '10.00',
    },
  ],
}

describe('PurchaseOrderDetail autosave', () => {
  let queryClient: QueryClient
  let updateItem: ReturnType<typeof vi.fn>
  let markAsSent: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.clearAllMocks()
    updateItem = vi.fn().mockResolvedValue({})
    markAsSent = vi.fn().mockResolvedValue({})

    asMock(purchaseOrderApi.usePurchaseOrder).mockReturnValue({
      data: draftPurchaseOrder,
      isLoading: false,
      error: null,
    })
    asMock(purchaseOrderApi.useUpdatePOItem).mockReturnValue({
      mutateAsync: updateItem,
    })
    asMock(purchaseOrderApi.useMarkPOSent).mockReturnValue({
      mutateAsync: markAsSent,
      isPending: false,
    })
    asMock(purchaseOrderApi.useAddPOItems).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
    asMock(purchaseOrderApi.useDeletePOItem).mockReturnValue({
      mutate: vi.fn(),
    })
    asMock(purchaseOrderApi.useReceiveGoods).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
    asMock(inventoryApi.useInventory).mockReturnValue({
      data: { data: [] },
      isLoading: false,
    })
    asMock(purchaseInvoiceApi.useUnbilledReceipts).mockReturnValue({
      data: [],
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const renderPage = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PurchaseOrderDetail />
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('flushes a pending quantity autosave before marking the PO as sent', async () => {
    vi.useFakeTimers()
    renderPage()

    fireEvent.click(screen.getByText('1', { selector: '.cursor-pointer' }))
    const qtyInput = screen
      .getAllByDisplayValue('1')
      .find((element) => element.getAttribute('min') === '1')
    expect(qtyInput).toBeDefined()
    fireEvent.change(qtyInput!, {
      target: { value: '5' },
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(updateItem).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Mark as Sent' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(updateItem).toHaveBeenCalledWith({
      orderId: 'po-1',
      itemId: 'item-1',
      updates: { quantity: 5 },
    })
    expect(markAsSent).toHaveBeenCalledWith('po-1')
    expect(updateItem.mock.invocationCallOrder[0]).toBeLessThan(
      markAsSent.mock.invocationCallOrder[0],
    )
  })
})
