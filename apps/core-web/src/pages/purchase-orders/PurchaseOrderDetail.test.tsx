import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import deCommon from '../../../../../locales/de/common.json'
import deFinance from '../../../../../locales/de/finance.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import { toast } from 'sonner'
import { formatDate } from '@/lib/format'
import PurchaseOrderDetail from './PurchaseOrderDetail'

registerGermanUiForTests()
import * as purchaseOrderApi from '@/api/purchase-orders'
import * as inventoryApi from '@/api/inventory'
import * as purchaseInvoiceApi from '@/api/usePurchaseInvoices'

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const navigateMock = vi.hoisted(() => vi.fn())

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
    useNavigate: () => navigateMock,
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

    fireEvent.click(screen.getByRole('button', { name: deFinance.actions.markAsSent }))

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

const detail = deFinance.purchaseOrders.detail

const boschPart = {
  id: 'catalog-2',
  name: 'Brake disc',
  sku: 'BRK-002',
  price: 25,
  quantity_available: 4,
  brand: 'Bosch',
}
const mergePart = { ...boschPart, id: 'catalog-1', sku: 'BRK-001', name: 'Brake pads' }
const otherBrandPart = { ...boschPart, id: 'catalog-9', sku: 'OTH-009', name: 'Wiper', brand: 'Other' }

describe('PurchaseOrderDetail behavior', () => {
  let updateMutateAsync: ReturnType<typeof vi.fn>
  let updateMutate: ReturnType<typeof vi.fn>
  let addMutate: ReturnType<typeof vi.fn>
  let deleteMutate: ReturnType<typeof vi.fn>
  let receiveMutate: ReturnType<typeof vi.fn>
  let markAsSentAsync: ReturnType<typeof vi.fn>
  let confirmMock: ReturnType<typeof vi.fn>

  const setPo = (po: unknown) =>
    asMock(purchaseOrderApi.usePurchaseOrder).mockReturnValue({
      data: po,
      isLoading: false,
      error: null,
    })
  const setInventory = (items: unknown[]) =>
    asMock(inventoryApi.useInventory).mockReturnValue({ data: { data: items } })
  const setUnbilled = (items: unknown[]) =>
    asMock(purchaseInvoiceApi.useUnbilledReceipts).mockReturnValue({ data: items })
  const succeedWith = (mutate: ReturnType<typeof vi.fn>) =>
    mutate.mockImplementation((_vars, options) => options.onSuccess())
  const failWith = (mutate: ReturnType<typeof vi.fn>) =>
    mutate.mockImplementation((_vars, options) => options.onError(new Error('boom')))

  beforeEach(() => {
    vi.clearAllMocks()
    updateMutateAsync = vi.fn().mockResolvedValue({})
    updateMutate = vi.fn()
    addMutate = vi.fn()
    deleteMutate = vi.fn()
    receiveMutate = vi.fn()
    markAsSentAsync = vi.fn().mockResolvedValue({})
    confirmMock = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirmMock)

    setPo(draftPurchaseOrder)
    setInventory([])
    setUnbilled([])
    asMock(purchaseOrderApi.useUpdatePOItem).mockReturnValue({
      mutate: updateMutate,
      mutateAsync: updateMutateAsync,
    })
    asMock(purchaseOrderApi.useMarkPOSent).mockReturnValue({
      mutateAsync: markAsSentAsync,
      isPending: false,
    })
    asMock(purchaseOrderApi.useAddPOItems).mockReturnValue({ mutate: addMutate, isPending: false })
    asMock(purchaseOrderApi.useDeletePOItem).mockReturnValue({ mutate: deleteMutate })
    asMock(purchaseOrderApi.useReceiveGoods).mockReturnValue({
      mutate: receiveMutate,
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const renderPage = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PurchaseOrderDetail />
        </MemoryRouter>
      </QueryClientProvider>,
    )

  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })

  const rowFor = (sku: string) => screen.getByText(sku, { selector: 'td' }).closest('tr')!
  const searchInput = () => screen.getByPlaceholderText(detail.searchPartsPlaceholder)
  const qtyInput = () => screen.getByPlaceholderText(detail.qtyPlaceholder)
  const addButton = () => screen.getByRole('button', { name: detail.addButton })
  const openEditor = () => fireEvent.click(screen.getByRole('button', { name: '1' }))

  describe('load states', () => {
    it('shows the loading text', () => {
      asMock(purchaseOrderApi.usePurchaseOrder).mockReturnValue({ data: undefined, isLoading: true, error: null })
      renderPage()
      expect(screen.getByText(deFinance.shared.loading)).toBeInTheDocument()
    })

    it('shows the load error before the not-found text', () => {
      asMock(purchaseOrderApi.usePurchaseOrder).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('x'),
      })
      renderPage()
      expect(screen.getByText(detail.loadError)).toBeInTheDocument()
    })

    it('shows the not-found text when there is no order', () => {
      setPo(undefined)
      renderPage()
      expect(screen.getByText(detail.notFound)).toBeInTheDocument()
    })
  })

  describe('header and summary cards', () => {
    it('renders the draft order with vendor card, counts and header actions', () => {
      setPo({
        ...draftPurchaseOrder,
        vendor: { ...draftPurchaseOrder.vendor, email: 'sales@bosch.test', account_number: 'K-77' },
      })
      renderPage()

      expect(screen.getByRole('heading', { name: 'PO-2026-0001' })).toBeInTheDocument()
      expect(screen.getByText('Lieferant: Bosch Automotive')).toBeInTheDocument()
      expect(screen.getByText(formatDate('2026-08-18T00:00:00.000Z'))).toBeInTheDocument()
      expect(screen.getByText('sales@bosch.test')).toBeInTheDocument()
      expect(screen.getByText('Konto: K-77')).toBeInTheDocument()
      expect(screen.getByText('0 Positionen')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: deFinance.actions.markAsSent })).toBeEnabled()
      expect(screen.getByRole('button', { name: deFinance.actions.receiveGoods })).toBeInTheDocument()
    })

    it('omits vendor email and account number when missing', () => {
      renderPage()
      expect(screen.queryByText(/Konto:/)).not.toBeInTheDocument()
      expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    })

    it('hides the draft-only actions for a sent order and the receive action for a completed order', () => {
      setPo({ ...draftPurchaseOrder, status: 'SENT' })
      const { unmount } = renderPage()
      expect(screen.queryByRole('button', { name: deFinance.actions.markAsSent })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: deFinance.actions.receiveGoods })).toBeInTheDocument()
      unmount()

      setPo({ ...draftPurchaseOrder, status: 'COMPLETED' })
      renderPage()
      expect(screen.queryByRole('button', { name: deFinance.actions.receiveGoods })).not.toBeInTheDocument()
    })

    it('disables the bill button without unbilled receipts of this order', () => {
      setUnbilled([{ purchaseOrderNumber: 'PO-OTHER' }])
      renderPage()
      expect(screen.getByRole('button', { name: /Eingangsrechnung anlegen \(0 Positionen\)/ })).toBeDisabled()
    })

    it('counts unbilled receipts of this order and navigates to the bill form', () => {
      setUnbilled([{ purchaseOrderNumber: 'PO-2026-0001' }, { purchaseOrderNumber: 'PO-OTHER' }])
      renderPage()

      expect(purchaseInvoiceApi.useUnbilledReceipts).toHaveBeenCalledWith('vendor-1')
      const button = screen.getByRole('button', { name: 'Eingangsrechnung anlegen (1 Position)' })
      expect(button).toBeEnabled()
      fireEvent.click(button)
      expect(navigateMock).toHaveBeenCalledWith('/purchase-invoices/new?vendorId=vendor-1&poId=po-1')
    })
  })

  describe('line item table', () => {
    it('renders ordered, received, remaining and formatted cost', () => {
      setPo({
        ...draftPurchaseOrder,
        items: [{ ...draftPurchaseOrder.items[0], quantity: 5, quantity_received: 2, unit_cost: 10 }],
      })
      renderPage()

      const row = within(rowFor('BRK-001'))
      expect(row.getByText('Brake pads')).toBeInTheDocument()
      expect(row.getByText('5')).toBeInTheDocument()
      expect(row.getByText('2')).toBeInTheDocument()
      expect(row.getByText('3')).toBeInTheDocument()
      expect(row.getByText(/10,00/)).toBeInTheDocument()
    })

    it('falls back for a missing catalog item and a missing unit cost', () => {
      setPo({
        ...draftPurchaseOrder,
        items: [{ ...draftPurchaseOrder.items[0], catalog_item: null, unit_cost: null }],
      })
      renderPage()

      const row = within(rowFor(deFinance.shared.notAvailable))
      expect(row.getByText(deFinance.shared.unknownItem)).toBeInTheDocument()
      expect(row.getByText(deCommon.placeholders.missing)).toBeInTheDocument()
      expect(
        row.getByRole('button', {
          name: `${detail.deleteItem} ${deFinance.shared.notAvailable} ${deFinance.shared.unknownItem}`,
        }),
      ).toBeInTheDocument()
    })

    it('disables deleting a received line and explains why', () => {
      setPo({
        ...draftPurchaseOrder,
        items: [{ ...draftPurchaseOrder.items[0], quantity: 3, quantity_received: 1 }],
      })
      renderPage()

      const button = within(rowFor('BRK-001')).getByRole('button', { name: /Position löschen/ })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', detail.cannotDeleteReceived)
    })

    it('does not delete when the confirm dialog is declined', () => {
      confirmMock.mockReturnValue(false)
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: /Position löschen/ }))
      expect(confirmMock).toHaveBeenCalledWith(detail.deleteItemConfirm)
      expect(deleteMutate).not.toHaveBeenCalled()
    })

    it('deletes a line and reports success', () => {
      succeedWith(deleteMutate)
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: /Position löschen/ }))
      expect(deleteMutate).toHaveBeenCalledWith({ orderId: 'po-1', itemId: 'item-1' }, expect.any(Object))
      expect(toast.success).toHaveBeenCalledWith(detail.toast.itemDeleted)
    })

    it('reports a failed delete with the error message', () => {
      failWith(deleteMutate)
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: /Position löschen/ }))
      expect(toast.error).toHaveBeenCalledWith(detail.toast.deleteItemFailed, { description: 'boom' })
    })
  })

  describe('inline quantity editing', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('opens an editor with the current quantity and closes it on Escape', () => {
      renderPage()
      openEditor()
      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(1)
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
      expect(updateMutateAsync).not.toHaveBeenCalled()
    })

    it('closes without saving on blur when the value is unchanged', async () => {
      renderPage()
      openEditor()
      fireEvent.blur(screen.getByRole('spinbutton'))
      await advance(1000)
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
      expect(updateMutateAsync).not.toHaveBeenCalled()
    })

    it('autosaves a changed quantity after the debounce and shows the saved indicator', async () => {
      renderPage()
      openEditor()
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } })

      await advance(700)
      expect(updateMutateAsync).not.toHaveBeenCalled()
      await advance(100)
      expect(updateMutateAsync).toHaveBeenCalledWith({
        orderId: 'po-1',
        itemId: 'item-1',
        updates: { quantity: 4 },
      })
      expect(screen.getByText(deCommon.documentSave.saved)).toBeInTheDocument()
    })

    it('does not autosave an invalid or unchanged quantity', async () => {
      renderPage()
      openEditor()
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '01' } })
      await advance(1000)
      expect(updateMutateAsync).not.toHaveBeenCalled()
    })

    it('saves immediately on blur with a changed value and closes the editor', async () => {
      renderPage()
      openEditor()
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '6' } })
      fireEvent.blur(screen.getByRole('spinbutton'))
      await advance(0)
      expect(updateMutateAsync).toHaveBeenCalledWith({
        orderId: 'po-1',
        itemId: 'item-1',
        updates: { quantity: 6 },
      })
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    })

    it('saves immediately on Enter', async () => {
      renderPage()
      openEditor()
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
      fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' })
      await advance(0)
      expect(updateMutateAsync).toHaveBeenCalledTimes(1)
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ updates: { quantity: 7 } }),
      )
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    })

    it('keeps the editor open and saves nothing for a non-positive quantity on Enter', async () => {
      renderPage()
      openEditor()
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })
      fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' })
      await advance(1000)
      expect(screen.getByRole('spinbutton')).toBeInTheDocument()
      expect(updateMutateAsync).not.toHaveBeenCalled()
    })

    it('refuses to reduce a line below the received quantity', async () => {
      setPo({
        ...draftPurchaseOrder,
        items: [{ ...draftPurchaseOrder.items[0], quantity: 5, quantity_received: 3 }],
      })
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: '5' }))
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
      fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' })

      expect(toast.error).toHaveBeenCalledWith(detail.toast.invalidQuantity, {
        description: 'Menge kann nicht unter 3 (bereits empfangen) reduziert werden',
      })
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
      expect(updateMutateAsync).not.toHaveBeenCalled()
    })

    it.each(['Enter', 'blur'])(
      'cancels the pending autosave when %s refuses a quantity below the received one',
      async (trigger) => {
        setPo({
          ...draftPurchaseOrder,
          items: [{ ...draftPurchaseOrder.items[0], quantity: 5, quantity_received: 3 }],
        })
        renderPage()
        fireEvent.click(screen.getByRole('button', { name: '5' }))
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
        if (trigger === 'Enter') {
          fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' })
        } else {
          fireEvent.blur(screen.getByRole('spinbutton'))
        }

        expect(toast.error).toHaveBeenCalledTimes(1)
        await advance(1000)
        expect(updateMutateAsync).not.toHaveBeenCalled()
      },
    )

    it('does not autosave on a non-draft order', async () => {
      setPo({ ...draftPurchaseOrder, status: 'SENT' })
      renderPage()
      openEditor()
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } })
      await advance(1000)
      expect(updateMutateAsync).not.toHaveBeenCalled()
    })
  })

  describe('mark as sent', () => {
    it('shows the promise toast with the three messages', async () => {
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: deFinance.actions.markAsSent }))
      await act(async () => {
        await Promise.resolve()
      })
      expect(markAsSentAsync).toHaveBeenCalledWith('po-1')
      expect(toast.promise).toHaveBeenCalledWith(expect.any(Promise), {
        loading: detail.toast.markingSent,
        success: detail.toast.markedSent,
        error: detail.toast.markSentFailed,
      })
      expect(updateMutateAsync).not.toHaveBeenCalled()
    })

    it('does not flush an invalid pending quantity', async () => {
      renderPage()
      openEditor()
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })
      fireEvent.click(screen.getByRole('button', { name: deFinance.actions.markAsSent }))
      await act(async () => {
        await Promise.resolve()
      })
      expect(updateMutateAsync).not.toHaveBeenCalled()
      expect(markAsSentAsync).toHaveBeenCalledWith('po-1')
    })

    it('disables the button while the mutation is pending', () => {
      asMock(purchaseOrderApi.useMarkPOSent).mockReturnValue({
        mutateAsync: markAsSentAsync,
        isPending: true,
      })
      renderPage()
      expect(screen.getByRole('button', { name: deFinance.actions.markAsSent })).toBeDisabled()
    })
  })

  describe('quick add', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      setInventory([boschPart, otherBrandPart])
    })

    const typeSearch = async (value: string) => {
      fireEvent.focus(searchInput())
      fireEvent.change(searchInput(), { target: { value } })
      await advance(300)
    }

    it('starts with the quantity and add button disabled and no suggestions', () => {
      renderPage()
      expect(qtyInput()).toBeDisabled()
      expect(addButton()).toBeDisabled()
      expect(screen.queryByText(detail.partsGroup)).not.toBeInTheDocument()
    })

    it('queries the inventory with the trimmed, debounced search and lists only vendor-brand parts', async () => {
      renderPage()
      fireEvent.focus(searchInput())
      fireEvent.change(searchInput(), { target: { value: '  brk ' } })
      await advance(200)
      expect(screen.queryByText(detail.partsGroup)).not.toBeInTheDocument()
      await advance(100)

      expect(inventoryApi.useInventory).toHaveBeenLastCalledWith({
        search: 'brk',
        pageSize: 100,
        brand: undefined,
      })
      expect(screen.getByText(detail.partsGroup)).toBeInTheDocument()
      expect(screen.getByText('BRK-002')).toBeInTheDocument()
      expect(screen.getByText(/25,00/)).toBeInTheDocument()
      expect(screen.getByText('Bestand: 4')).toBeInTheDocument()
      expect(screen.queryByText('OTH-009')).not.toBeInTheDocument()
    })

    it('shows the no-parts message when no suggestion matches the vendor brands', async () => {
      setInventory([otherBrandPart])
      renderPage()
      await typeSearch('oth')
      expect(screen.getByText(detail.noPartsForBrands)).toBeInTheDocument()
    })

    it('shows the no-brands message when the vendor has no brands', async () => {
      setPo({ ...draftPurchaseOrder, vendor: { ...draftPurchaseOrder.vendor, supportedBrands: [] } })
      renderPage()
      await typeSearch('brk')
      expect(screen.getByText(detail.noVendorBrands)).toBeInTheDocument()
    })

    it('stages a clicked suggestion, resets the quantity and hides the suggestions', async () => {
      renderPage()
      await typeSearch('brk')
      fireEvent.click(screen.getByText('BRK-002'))

      expect(searchInput()).toHaveValue('BRK-002 · Brake disc')
      expect(qtyInput()).toBeEnabled()
      expect(qtyInput()).toHaveValue('1')
      expect(addButton()).toBeEnabled()
      expect(screen.queryByText(detail.partsGroup)).not.toBeInTheDocument()
    })

    it('stages the first suggestion on Enter and ignores other keys', async () => {
      renderPage()
      await typeSearch('brk')
      fireEvent.keyDown(searchInput(), { key: 'a' })
      expect(qtyInput()).toBeDisabled()
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      expect(searchInput()).toHaveValue('BRK-002 · Brake disc')
      expect(qtyInput()).toBeEnabled()
    })

    it('does nothing on Enter without a suggestion', async () => {
      setInventory([])
      renderPage()
      await typeSearch('zzz')
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      expect(qtyInput()).toBeDisabled()
    })

    it('un-stages the part when the search text is edited', async () => {
      renderPage()
      await typeSearch('brk')
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      fireEvent.change(searchInput(), { target: { value: 'x' } })
      expect(qtyInput()).toBeDisabled()
    })

    it('adds a new line with the staged part price and clears the quick entry', async () => {
      succeedWith(addMutate)
      renderPage()
      await typeSearch('brk')
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      fireEvent.change(qtyInput(), { target: { value: '3' } })
      fireEvent.click(addButton())

      expect(addMutate).toHaveBeenCalledWith(
        { orderId: 'po-1', items: [{ catalogItemId: 'catalog-2', quantity: 3, unitCost: 25 }] },
        expect.any(Object),
      )
      expect(toast.success).toHaveBeenCalledWith(detail.toast.itemAdded)
      expect(searchInput()).toHaveValue('')
      expect(qtyInput()).toHaveValue('1')
      expect(qtyInput()).toBeDisabled()
    })

    it('confirms on Enter in the quantity field', async () => {
      renderPage()
      await typeSearch('brk')
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      fireEvent.keyDown(qtyInput(), { key: 'Enter' })
      expect(addMutate).toHaveBeenCalledTimes(1)
    })

    it('keeps the entry and reports a failed add', async () => {
      failWith(addMutate)
      renderPage()
      await typeSearch('brk')
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      fireEvent.click(addButton())

      expect(toast.error).toHaveBeenCalledWith(detail.toast.addItemFailed, { description: 'boom' })
      expect(searchInput()).toHaveValue('BRK-002 · Brake disc')
    })

    it.each(['0', 'abc', '-2'])('rejects the quantity "%s" with a toast and no mutation', async (value) => {
      renderPage()
      await typeSearch('brk')
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      fireEvent.change(qtyInput(), { target: { value } })
      fireEvent.click(addButton())

      expect(toast.error).toHaveBeenCalledWith(detail.toast.invalidQuantity, {
        description: detail.toast.positiveQuantity,
      })
      expect(addMutate).not.toHaveBeenCalled()
      expect(updateMutate).not.toHaveBeenCalled()
    })

    it('merges into an existing line, flashes it and clears the quick entry', async () => {
      setInventory([mergePart])
      succeedWith(updateMutate)
      renderPage()
      await typeSearch('brk')
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      fireEvent.change(qtyInput(), { target: { value: '2' } })
      fireEvent.click(addButton())

      expect(updateMutate).toHaveBeenCalledWith(
        { orderId: 'po-1', itemId: 'item-1', updates: { quantity: 3 } },
        expect.any(Object),
      )
      expect(addMutate).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('Menge auf 3 aktualisiert')
      expect(searchInput()).toHaveValue('')
      expect(rowFor('BRK-001')).toHaveClass('bg-blue-50/80')

      await advance(500)
      expect(rowFor('BRK-001')).not.toHaveClass('bg-blue-50/80')
    })

    it('keeps the entry and reports a failed merge', async () => {
      setInventory([mergePart])
      failWith(updateMutate)
      renderPage()
      await typeSearch('brk')
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      fireEvent.click(addButton())

      expect(toast.error).toHaveBeenCalledWith(detail.toast.updateItemFailed, { description: 'boom' })
      expect(rowFor('BRK-001')).not.toHaveClass('bg-blue-50/80')
    })

    it('shows an ellipsis and disables the button while an add is pending', async () => {
      asMock(purchaseOrderApi.useAddPOItems).mockReturnValue({ mutate: addMutate, isPending: true })
      renderPage()
      await typeSearch('brk')
      fireEvent.keyDown(searchInput(), { key: 'Enter' })
      const button = screen.getByRole('button', { name: '...' })
      expect(button).toBeDisabled()
    })
  })

  describe('receive goods dialog', () => {
    beforeEach(() => {
      setPo({
        ...draftPurchaseOrder,
        status: 'PARTIAL',
        items: [
          draftPurchaseOrder.items[0],
          {
            id: 'item-2',
            catalog_item_id: 'catalog-5',
            catalog_item: { sku: 'FIL-005', name: 'Filter' },
            quantity: 5,
            quantity_received: 5,
            unit_cost: '4.00',
          },
        ],
      })
    })

    const openDialog = () => {
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: deFinance.actions.receiveGoods }))
      return within(screen.getByRole('dialog'))
    }

    it('lists only lines with a remaining quantity', () => {
      const dialog = openDialog()
      expect(dialog.getByText('Wareneingang für PO-2026-0001')).toBeInTheDocument()
      expect(dialog.getByText('BRK-001')).toBeInTheDocument()
      expect(dialog.queryByText('FIL-005')).not.toBeInTheDocument()
    })

    it('does nothing when no quantity is entered', () => {
      const dialog = openDialog()
      fireEvent.click(dialog.getByRole('button', { name: deFinance.actions.confirmReceipt }))
      expect(receiveMutate).not.toHaveBeenCalled()
    })

    it('submits the positive quantities and closes on success', () => {
      succeedWith(receiveMutate)
      const dialog = openDialog()
      fireEvent.change(dialog.getByRole('spinbutton'), { target: { value: '1' } })
      fireEvent.click(dialog.getByRole('button', { name: deFinance.actions.confirmReceipt }))

      expect(receiveMutate).toHaveBeenCalledWith(
        { orderId: 'po-1', items: [{ itemId: 'item-1', quantity: 1 }] },
        expect.any(Object),
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('reports a failed receipt and keeps the dialog open', () => {
      failWith(receiveMutate)
      const dialog = openDialog()
      fireEvent.change(dialog.getByRole('spinbutton'), { target: { value: '1' } })
      fireEvent.click(dialog.getByRole('button', { name: deFinance.actions.confirmReceipt }))

      expect(toast.error).toHaveBeenCalledWith(detail.toast.receiveFailed, { description: 'boom' })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('closes on cancel', () => {
      const dialog = openDialog()
      fireEvent.click(dialog.getByRole('button', { name: deFinance.actions.cancel }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('shows the processing label while receiving', () => {
      asMock(purchaseOrderApi.useReceiveGoods).mockReturnValue({ mutate: receiveMutate, isPending: true })
      const dialog = openDialog()
      expect(dialog.getByRole('button', { name: deFinance.shared.processing })).toBeDisabled()
    })
  })
})
