import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import InvoiceDraftEditPage from './InvoiceDraftEditPage'
import { deSales } from '@/test/de-sales'
import deCommon from '../../../../../locales/de/common.json'
import deErrors from '../../../../../locales/de/errors.json'

const invoiceEditor = deSales.invoiceEditor
const accountingMappingIncomplete = deErrors.codes.ACCOUNTING_MAPPING_INCOMPLETE
import { invoiceKeys } from '@/api/sales'
import * as salesApi from '@/api/sales'
import * as salesOrdersApi from '@/api/sales-orders'
import * as inventoryApi from '@/api/inventory'
import type { Customer } from '@/api/types'
import { DOCUMENT_AUTOSAVE_DEBOUNCE_MS } from '@/hooks/useDebouncedAutoSave'
import { triggerBlobDownload } from '@/lib/download'
import { formatCurrency } from '@/lib/format'
import { format } from 'date-fns'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/api/sales')
vi.mock('@/api/sales-orders')
vi.mock('@/api/inventory')
vi.mock('@/lib/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/download')>()),
  triggerBlobDownload: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { toast } from 'sonner'

vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: ({
    onChange,
  }: {
    onChange: (customer: Customer | null) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          id: 'cust-1',
          type: 'PRIVATE',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
        })
      }
    >
      Select customer
    </button>
  ),
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const mockInvoice = {
  id: 'inv-1',
  status: 'DRAFT',
  sales_order_id: 'so-1',
  customer_id: 'cust-1',
  customer: {
    id: 'cust-1',
    type: 'PRIVATE',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
  },
  date: '2026-09-21T00:00:00.000Z',
  due_date: '2026-10-05T00:00:00.000Z',
  total_net: '1',
  total_tax: '0.2',
  total_gross: '1.2',
  items: [
    {
      id: 'line-1',
      description: 'Brake pads',
      quantity: '1',
      unit_price: '1',
      tax_rate: '20',
      line_total: '1',
    },
  ],
}

describe('InvoiceDraftEditPage autosave', () => {
  let queryClient: QueryClient
  const invoiceRef = { current: mockInvoice as typeof mockInvoice }

  beforeEach(() => {
    invoiceRef.current = { ...mockInvoice, items: [{ ...mockInvoice.items[0] }] }
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.clearAllMocks()
    mockNavigate.mockReset()
    asMock(inventoryApi.useInventory).mockReturnValue({ data: { data: [] }, isLoading: false })
    asMock(salesOrdersApi.useSalesOrder).mockReturnValue({
      data: { id: 'so-1', status: 'CONFIRMED' },
      isLoading: false,
    })
    asMock(salesApi.useInvoice).mockImplementation(() => ({
      data: invoiceRef.current,
      isLoading: false,
      error: null,
    }))
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  const renderPage = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sales/invoices/inv-1/edit']}>
          <Routes>
            <Route path="/sales/invoices/:id/edit" element={<InvoiceDraftEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

  const openFinalizeDialog = () => {
    fireEvent.click(screen.getByRole('button', { name: deSales.invoices.draft.finalize }))
  }

  const confirmFinalize = () => {
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: invoiceEditor.finalizeDialog.confirm }),
    )
  }

  it('auto-saves draft updates for a sales-order-sourced invoice', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })

    renderPage()

    fireEvent.change(screen.getByPlaceholderText(invoiceEditor.lineItemsTable.descriptionPlaceholder), {
      target: { value: 'Brake pads premium' },
    })

    await waitFor(
      () => {
        expect(updateMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'inv-1',
            payload: expect.objectContaining({
              items: expect.arrayContaining([
                expect.objectContaining({ description: 'Brake pads premium' }),
              ]),
            }),
          }),
        )
      },
      { timeout: 2000 },
    )

    expect(await screen.findByText(deCommon.documentSave.saved)).toBeInTheDocument()
  })

  it('does not PATCH an unchanged draft on open', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })

    renderPage()
    await screen.findByDisplayValue('Brake pads')

    await new Promise((resolve) => {
      setTimeout(resolve, DOCUMENT_AUTOSAVE_DEBOUNCE_MS + 100)
    })

    expect(updateMutation).not.toHaveBeenCalled()
  })

  it('does not re-hydrate from a refetched invoice object while the user is editing', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })

    const { rerender } = renderPage()
    await screen.findByDisplayValue('Brake pads')

    fireEvent.change(screen.getByPlaceholderText(invoiceEditor.lineItemsTable.descriptionPlaceholder), {
      target: { value: 'User typed value' },
    })

    const callsAfterEdit = updateMutation.mock.calls.length

    invoiceRef.current = {
      ...mockInvoice,
      items: [{ ...mockInvoice.items[0], description: 'Brake pads' }],
    }
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sales/invoices/inv-1/edit']}>
          <Routes>
            <Route path="/sales/invoices/:id/edit" element={<InvoiceDraftEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByDisplayValue('User typed value')).toBeInTheDocument()
    expect(updateMutation.mock.calls.length).toBe(callsAfterEdit)
  })

  it('seeds invoice detail cache with FINALIZED before navigating to detail', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    const finalized = {
      ...mockInvoice,
      status: 'FINALIZED',
      invoice_number: 'RE-2026-0001',
    }
    const finalizeMutation = vi.fn().mockResolvedValue(finalized)
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: finalizeMutation,
      isPending: false,
    })

    renderPage()

    openFinalizeDialog()
    confirmFinalize()

    await waitFor(() => {
      expect(queryClient.getQueryData(invoiceKeys.detail('inv-1'))).toEqual(finalized)
      expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices/inv-1')
    })
  })

  it('does not block finalize when the linked sales order is still draft', async () => {
    asMock(salesOrdersApi.useSalesOrder).mockReturnValue({
      data: { id: 'so-1', status: 'DRAFT' },
      isLoading: false,
    })
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(mockInvoice),
      isPending: false,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })

    renderPage()

    const finalizeButton = await screen.findByRole('button', { name: deSales.invoices.draft.finalize })
    expect(finalizeButton).not.toBeDisabled()
    fireEvent.click(finalizeButton)
    expect(await screen.findByText(invoiceEditor.finalizeDialog.title)).toBeInTheDocument()
  })

  it('calls finalize after confirm and navigates only on success', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    const finalizeMutation = vi.fn().mockResolvedValue({
      ...mockInvoice,
      status: 'FINALIZED',
      invoice_number: 'RE-2026-0001',
    })
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: finalizeMutation,
      isPending: false,
    })

    renderPage()

    openFinalizeDialog()
    confirmFinalize()

    await waitFor(() => {
      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'inv-1',
        }),
      )
      expect(finalizeMutation).toHaveBeenCalledWith('inv-1')
      expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices/inv-1')
      expect(toast.success).toHaveBeenCalledWith(
        deSales.invoices.draft.finalizedSuccess,
        expect.objectContaining({ action: expect.objectContaining({ label: 'Open' }) }),
      )
    })
    expect(triggerBlobDownload).not.toHaveBeenCalled()
  })

  it('opens the finalized invoice from the success toast Open action', async () => {
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(mockInvoice),
      isPending: false,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        ...mockInvoice,
        status: 'FINALIZED',
        invoice_number: 'RE-2026-0001',
      }),
      isPending: false,
    })

    renderPage()

    openFinalizeDialog()
    confirmFinalize()

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const [, toastOptions] = vi.mocked(toast.success).mock.calls[0] as unknown as [
      string,
      { action: { onClick: () => void } },
    ]
    mockNavigate.mockClear()
    toastOptions.action.onClick()

    expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices/inv-1')
  })

  it('labels the finalize action Finalize and offers no Print action', async () => {
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(mockInvoice),
      isPending: false,
    })

    renderPage()

    expect(await screen.findByRole('button', { name: deSales.invoices.draft.finalize })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument()

    openFinalizeDialog()

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: invoiceEditor.finalizeDialog.confirm })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument()
  })

  it('surfaces the branding writer gate message when finalize is blocked', async () => {
    const brandingGateMessage =
      'Rechnungen mit Briefpapier sind in dieser Umgebung noch nicht aktiviert. Das Ausstellen ist möglich, sobald die Funktion freigeschaltet ist.'
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    const finalizeMutation = vi.fn().mockRejectedValue(
      Object.assign(new Error('api'), {
        status: 503,
        data: { statusCode: 503, code: 'INVOICE_BRANDING_WRITER_DISABLED' },
      }),
    )
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: finalizeMutation,
      isPending: false,
    })

    renderPage()

    openFinalizeDialog()
    confirmFinalize()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(brandingGateMessage)
      expect(screen.getByText(brandingGateMessage)).toBeInTheDocument()
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  it('surfaces Nest API errors when finalize fails and does not navigate', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    const finalizeMutation = vi.fn().mockRejectedValue(
      Object.assign(new Error('api'), {
        status: 422,
        data: { statusCode: 422, code: 'ACCOUNTING_MAPPING_INCOMPLETE' },
      }),
    )
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: finalizeMutation,
      isPending: false,
    })

    renderPage()

    openFinalizeDialog()
    confirmFinalize()

    await waitFor(() => {
      expect(finalizeMutation).toHaveBeenCalledWith('inv-1')
      expect(toast.error).toHaveBeenCalledWith(accountingMappingIncomplete)
      expect(screen.getByText(accountingMappingIncomplete)).toBeInTheDocument()
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  it('shows ATP 409 finalize errors inside the confirm dialog', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    const finalizeMutation = vi.fn().mockRejectedValue(
      Object.assign(new Error('api'), {
        status: 409,
        data: { statusCode: 409, code: 'HTTP_409' },
      }),
    )
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: finalizeMutation,
      isPending: false,
    })

    renderPage()

    openFinalizeDialog()
    confirmFinalize()

    const conflictMessage = 'Die Anfrage steht im Konflikt mit dem aktuellen Stand.'

    await waitFor(() => {
      expect(screen.getByText(conflictMessage)).toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledWith(conflictMessage)
    })

    expect(screen.getByText(invoiceEditor.finalizeDialog.title)).toBeInTheDocument()
  })

  it('surfaces API message when autosave fails', async () => {
    const updateMutation = vi.fn().mockRejectedValue(
      Object.assign(new Error('api'), {
        status: 400,
        data: { statusCode: 400, code: 'SOURCE_DOCUMENT_REQUIRED' },
      }),
    )
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })

    renderPage()

    fireEvent.change(screen.getByPlaceholderText(invoiceEditor.lineItemsTable.descriptionPlaceholder), {
      target: { value: 'Updated line' },
    })

    await waitFor(
      () => {
        expect(toast.error).toHaveBeenCalledWith('Auto-save failed', {
          description:
            'Rechnungen ohne zugrunde liegenden Auftrag sind nicht möglich. Bitte legen Sie die Rechnung aus einem Kundenauftrag an.',
        })
      },
      { timeout: 3000 },
    )
  })

  describe('characterization', () => {
    const invoiceWith = (overrides: Record<string, unknown>) =>
      ({ ...mockInvoice, ...overrides }) as typeof mockInvoice
    const neverSettles = () => new Promise<never>(() => {})
    const descriptionInput = () =>
      screen.getByPlaceholderText(invoiceEditor.lineItemsTable.descriptionPlaceholder)
    const waitForDebounce = () =>
      new Promise((resolve) => {
        setTimeout(resolve, DOCUMENT_AUTOSAVE_DEBOUNCE_MS + 100)
      })
    const mockUpdate = (mutateAsync: ReturnType<typeof vi.fn>) =>
      asMock(salesApi.useUpdateInvoice).mockReturnValue({ mutateAsync, isPending: false })
    const mockFinalize = (mutateAsync: ReturnType<typeof vi.fn>) =>
      asMock(salesApi.useFinalizeInvoice).mockReturnValue({ mutateAsync, isPending: false })
    // Text matchers do not normalize the no-break space that de-AT currency output uses.
    const money = (amount: number) => formatCurrency(amount).replace(/\s/g, ' ')

    it('shows the not-found notice when the route has no invoice id', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/sales/invoices/edit']}>
            <Routes>
              <Route path="/sales/invoices/edit" element={<InvoiceDraftEditPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      )

      expect(screen.getByText(deSales.invoices.draft.notFound)).toBeInTheDocument()
    })

    it('shows the loading notice while the invoice is loading', () => {
      asMock(salesApi.useInvoice).mockImplementation(() => ({
        data: undefined,
        isLoading: true,
        error: null,
      }))

      renderPage()

      expect(screen.getByText(deSales.invoices.draft.loading)).toBeInTheDocument()
    })

    it('shows the load failure when the invoice query errors', () => {
      asMock(salesApi.useInvoice).mockImplementation(() => ({
        data: undefined,
        isLoading: false,
        error: new Error('boom'),
      }))

      renderPage()

      expect(screen.getByText(deSales.errors.loadFailed)).toBeInTheDocument()
    })

    it('shows the load failure when no invoice comes back', () => {
      asMock(salesApi.useInvoice).mockImplementation(() => ({
        data: undefined,
        isLoading: false,
        error: null,
      }))

      renderPage()

      expect(screen.getByText(deSales.errors.loadFailed)).toBeInTheDocument()
    })

    it('shows the unsupported notice with a link to the invoice when no sales order is linked', () => {
      invoiceRef.current = invoiceWith({ sales_order_id: null })

      renderPage()

      expect(screen.getByRole('heading', { name: deSales.invoices.draft.unsupportedTitle })).toBeInTheDocument()
      expect(screen.getByText(deSales.invoices.draft.unsupportedDescription)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: deSales.invoices.draft.viewInvoice })).toHaveAttribute(
        'href',
        '/sales/invoices/inv-1',
      )
      expect(screen.queryByRole('button', { name: deSales.invoices.draft.finalize })).not.toBeInTheDocument()
    })

    it('shows the not-editable notice when the invoice is no longer a draft', () => {
      invoiceRef.current = invoiceWith({ status: 'FINALIZED' })

      renderPage()

      expect(screen.getByRole('heading', { name: deSales.invoices.draft.notEditableTitle })).toBeInTheDocument()
      expect(screen.getByText(deSales.invoices.draft.notEditableDescription)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: deSales.invoices.draft.viewInvoice })).toHaveAttribute(
        'href',
        '/sales/invoices/inv-1',
      )
    })

    it('links the header back button to the sales order and titles the page', async () => {
      renderPage()

      expect(await screen.findByRole('link', { name: deSales.invoices.draft.backToOrderAria })).toHaveAttribute(
        'href',
        '/sales-orders/so-1',
      )
      expect(screen.getByRole('heading', { name: deSales.invoices.draft.title })).toBeInTheDocument()
    })

    it('disables finalize while the draft has no customer', async () => {
      invoiceRef.current = invoiceWith({ customer: null })

      renderPage()

      expect(await screen.findByRole('button', { name: deSales.invoices.draft.finalize })).toBeDisabled()
      expect(screen.queryByText(deSales.invoices.draft.noStreet)).not.toBeInTheDocument()
    })

    it('disables finalize with a spinner while the finalize request is pending', async () => {
      asMock(salesApi.useFinalizeInvoice).mockReturnValue({ mutateAsync: vi.fn(), isPending: true })

      renderPage()

      const finalizeButton = await screen.findByRole('button', { name: deSales.invoices.draft.finalize })
      expect(finalizeButton).toBeDisabled()
      expect(finalizeButton.querySelector('.animate-spin')).not.toBeNull()
    })

    it('blocks finalize and explains why when the sales order is already invoiced', async () => {
      asMock(salesOrdersApi.useSalesOrder).mockReturnValue({
        data: { id: 'so-1', status: 'INVOICED' },
        isLoading: false,
      })

      renderPage()

      const finalizeButton = await screen.findByRole('button', { name: deSales.invoices.draft.finalize })
      expect(finalizeButton).toBeDisabled()
      expect(finalizeButton).toHaveAttribute('title', deSales.finalize.salesOrderBlocked)
      expect(screen.getByText(deSales.finalize.salesOrderBlocked)).toBeInTheDocument()
    })

    it('blocks finalize without a message while the sales order is still loading', async () => {
      asMock(salesOrdersApi.useSalesOrder).mockReturnValue({ data: undefined, isLoading: true })

      renderPage()

      expect(await screen.findByRole('button', { name: deSales.invoices.draft.finalize })).toBeDisabled()
      expect(screen.queryByText(deSales.finalize.salesOrderBlocked)).not.toBeInTheDocument()
    })

    it('shows the customer address and email under the bill-to field', async () => {
      invoiceRef.current = invoiceWith({
        customer: {
          ...mockInvoice.customer,
          address_street: 'Hauptstraße 1',
          address_zip: '4020',
          address_city: 'Linz',
          address_country: 'Österreich',
        },
      })

      renderPage()

      expect(await screen.findByText('Hauptstraße 1')).toBeInTheDocument()
      expect(screen.getByText('4020 Linz')).toBeInTheDocument()
      expect(screen.getByText('Österreich')).toBeInTheDocument()
      expect(screen.getByText('E-Mail: ada@example.com')).toBeInTheDocument()
    })

    it('falls back to a placeholder when the customer has no street', async () => {
      invoiceRef.current = invoiceWith({ customer: { ...mockInvoice.customer, address_street: null } })

      renderPage()

      expect(await screen.findByText(deSales.invoices.draft.noStreet)).toBeInTheDocument()
    })

    it('shows subtotal, VAT and total for the hydrated lines', async () => {
      invoiceRef.current = invoiceWith({
        items: [{ ...mockInvoice.items[0], quantity: '2', unit_price: '10', tax_rate: '20' }],
      })

      renderPage()

      expect(await screen.findByText(money(20))).toBeInTheDocument()
      expect(screen.getByText(money(4))).toBeInTheDocument()
      expect(screen.getByText(money(24))).toBeInTheDocument()
    })

    it('shows the invoice and due dates in the date fields', async () => {
      renderPage()

      expect(
        await screen.findByDisplayValue(format(new Date(mockInvoice.date), 'yyyy-MM-dd')),
      ).toBeInTheDocument()
      expect(screen.getByDisplayValue(format(new Date(mockInvoice.due_date), 'yyyy-MM-dd'))).toBeInTheDocument()
    })

    it('updates the invoice date field when another date is picked', async () => {
      renderPage()

      const dateField = await screen.findByDisplayValue(format(new Date(mockInvoice.date), 'yyyy-MM-dd'))
      fireEvent.change(dateField, { target: { value: '2026-09-25' } })

      expect(dateField).toHaveValue(format(new Date('2026-09-25'), 'yyyy-MM-dd'))
    })

    it('autosaves once a customer is picked on an otherwise complete draft', async () => {
      invoiceRef.current = invoiceWith({ customer: null })
      const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
      mockUpdate(updateMutation)

      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Select customer' }))

      await waitFor(
        () => {
          expect(updateMutation).toHaveBeenCalledWith(
            expect.objectContaining({
              id: 'inv-1',
              payload: expect.objectContaining({ customerId: 'cust-1' }),
            }),
          )
        },
        { timeout: 2000 },
      )
    })

    it('does not autosave while a line description is blank', async () => {
      const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
      mockUpdate(updateMutation)

      renderPage()
      fireEvent.change(descriptionInput(), { target: { value: '   ' } })
      await waitForDebounce()

      expect(updateMutation).not.toHaveBeenCalled()
    })

    it('does not autosave a draft whose last line was removed, and keeps finalize disabled', async () => {
      const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
      mockUpdate(updateMutation)

      renderPage()
      fireEvent.click(screen.getByRole('button', { name: 'Position 1 entfernen' }))
      await waitForDebounce()

      expect(updateMutation).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: deSales.invoices.draft.finalize })).toBeDisabled()
    })

    it('keeps finalize disabled after adding a line that has no description', () => {
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: deSales.invoiceEditor.lineItemsTable.addLine }))

      expect(screen.getAllByPlaceholderText(invoiceEditor.lineItemsTable.descriptionPlaceholder)).toHaveLength(2)
      expect(screen.getByRole('button', { name: deSales.invoices.draft.finalize })).toBeDisabled()
    })

    it('fills a line from the part picked in the part search and autosaves it', async () => {
      invoiceRef.current = invoiceWith({ items: [{ ...mockInvoice.items[0], tax_rate: '10' }] })
      asMock(inventoryApi.useInventory).mockReturnValue({
        data: {
          data: [{ id: 'part-1', name: 'Bremsscheibe', sku: 'BS-1', price: 45, quantity_available: 3 }],
        },
        isLoading: false,
      })
      const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
      mockUpdate(updateMutation)

      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Teil für Position 1 suchen' }))
      fireEvent.click(await screen.findByText('Bremsscheibe'))

      expect(await screen.findByDisplayValue('Bremsscheibe')).toBeInTheDocument()
      expect(screen.getByDisplayValue('45')).toBeInTheDocument()
      await waitFor(
        () => {
          expect(updateMutation).toHaveBeenCalledWith(
            expect.objectContaining({
              payload: expect.objectContaining({
                items: [
                  expect.objectContaining({
                    catalogItemId: 'part-1',
                    description: 'Bremsscheibe',
                    unitPrice: 45,
                    taxRate: 20,
                  }),
                ],
              }),
            }),
          )
        },
        { timeout: 2000 },
      )
    })

    it('keeps the saved notes and catalog item in the autosave payload', async () => {
      invoiceRef.current = invoiceWith({
        notes: 'Danke für Ihren Auftrag',
        items: [{ ...mockInvoice.items[0], catalog_item_id: 'cat-9' }],
      })
      const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
      mockUpdate(updateMutation)

      renderPage()
      fireEvent.change(descriptionInput(), { target: { value: 'Brake pads premium' } })

      await waitFor(
        () => {
          expect(updateMutation).toHaveBeenCalledWith(
            expect.objectContaining({
              payload: expect.objectContaining({
                notes: 'Danke für Ihren Auftrag',
                items: [expect.objectContaining({ catalogItemId: 'cat-9', description: 'Brake pads premium' })],
              }),
            }),
          )
        },
        { timeout: 2000 },
      )
    })

    it('sends the edited draft to the server with the finalize request', async () => {
      const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
      const finalizeMutation = vi.fn().mockResolvedValue({
        ...mockInvoice,
        status: 'FINALIZED',
        invoice_number: 'RE-2026-0001',
      })
      mockUpdate(updateMutation)
      mockFinalize(finalizeMutation)

      renderPage()
      fireEvent.change(descriptionInput(), { target: { value: 'Brake pads premium' } })
      openFinalizeDialog()
      confirmFinalize()

      await waitFor(() => {
        expect(finalizeMutation).toHaveBeenCalledWith('inv-1')
      })
      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'inv-1',
          payload: expect.objectContaining({
            items: [expect.objectContaining({ description: 'Brake pads premium' })],
          }),
        }),
      )
    })

    it('blocks finalize while the draft is still saving', async () => {
      const updateMutation = vi.fn(() => neverSettles())
      const finalizeMutation = vi.fn()
      mockUpdate(updateMutation)
      mockFinalize(finalizeMutation)

      renderPage()
      fireEvent.change(descriptionInput(), { target: { value: 'Brake pads premium' } })
      expect(await screen.findByText(deCommon.documentSave.saving)).toBeInTheDocument()

      openFinalizeDialog()
      confirmFinalize()

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(deSales.finalize.saving)
      })
      expect(finalizeMutation).not.toHaveBeenCalled()
    })

    it('blocks finalize after the autosave failed', async () => {
      const updateMutation = vi.fn().mockRejectedValue(
        Object.assign(new Error('api'), {
          status: 400,
          data: { statusCode: 400, code: 'SOURCE_DOCUMENT_REQUIRED' },
        }),
      )
      const finalizeMutation = vi.fn()
      mockUpdate(updateMutation)
      mockFinalize(finalizeMutation)

      renderPage()
      fireEvent.change(descriptionInput(), { target: { value: 'Brake pads premium' } })
      expect(await screen.findByText(deCommon.documentSave.error)).toBeInTheDocument()

      openFinalizeDialog()
      confirmFinalize()

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(deSales.finalize.autosaveError)
      })
      expect(finalizeMutation).not.toHaveBeenCalled()
    })

    it('shows the save error and skips finalize when the draft cannot be saved first', async () => {
      const updateMutation = vi.fn().mockRejectedValue(
        Object.assign(new Error('api'), {
          status: 400,
          data: { statusCode: 400, code: 'SOURCE_DOCUMENT_REQUIRED' },
        }),
      )
      const finalizeMutation = vi.fn()
      mockUpdate(updateMutation)
      mockFinalize(finalizeMutation)

      renderPage()
      openFinalizeDialog()
      confirmFinalize()

      expect(
        await screen.findByText(
          'Rechnungen ohne zugrunde liegenden Auftrag sind nicht möglich. Bitte legen Sie die Rechnung aus einem Kundenauftrag an.',
        ),
      ).toBeInTheDocument()
      expect(finalizeMutation).not.toHaveBeenCalled()
    })

    it('keeps the finalize dialog open when it is dismissed while finalizing', async () => {
      mockUpdate(vi.fn().mockResolvedValue(mockInvoice))
      mockFinalize(vi.fn(() => neverSettles()))

      renderPage()
      openFinalizeDialog()
      confirmFinalize()

      expect(await screen.findByText(deSales.invoiceEditor.finalizeDialog.finalizing)).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    it('clears the finalize error when the dialog is dismissed and reopened', async () => {
      mockUpdate(vi.fn().mockResolvedValue(mockInvoice))
      mockFinalize(
        vi.fn().mockRejectedValue(
          Object.assign(new Error('api'), {
            status: 422,
            data: { statusCode: 422, code: 'ACCOUNTING_MAPPING_INCOMPLETE' },
          }),
        ),
      )

      renderPage()
      openFinalizeDialog()
      confirmFinalize()
      expect(await screen.findByText(accountingMappingIncomplete)).toBeInTheDocument()

      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: deCommon.actions.cancel }),
      )
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      openFinalizeDialog()

      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(screen.queryByText(accountingMappingIncomplete)).not.toBeInTheDocument()
    })

    it('shows the generic finalize error for an unexpected failure and stays on the page', async () => {
      mockUpdate(vi.fn().mockResolvedValue(mockInvoice))
      mockFinalize(vi.fn().mockRejectedValue(new Error('network down')))

      renderPage()
      openFinalizeDialog()
      confirmFinalize()

      expect(await screen.findByText(deSales.errors.generic)).toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledWith(deSales.errors.generic)
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('treats a finalize response without an invoice number as a failure', async () => {
      mockUpdate(vi.fn().mockResolvedValue(mockInvoice))
      mockFinalize(
        vi.fn().mockResolvedValue({ ...mockInvoice, status: 'FINALIZED', invoice_number: null }),
      )

      renderPage()
      openFinalizeDialog()
      confirmFinalize()

      expect(await screen.findByText(deSales.errors.generic)).toBeInTheDocument()
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('re-arms the draft autosave when finalize starts, so the same draft is saved again', async () => {
      // Current behavior, kept as-is in this refactor; fixing it is a separate ticket.
      const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
      mockUpdate(updateMutation)
      mockFinalize(
        vi.fn().mockResolvedValue({ ...mockInvoice, status: 'FINALIZED', invoice_number: 'RE-2026-0001' }),
      )

      renderPage()
      fireEvent.change(descriptionInput(), { target: { value: 'Brake pads premium' } })
      openFinalizeDialog()
      confirmFinalize()

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices/inv-1')
      })
      await waitForDebounce()

      expect(updateMutation).toHaveBeenCalledTimes(2)
      expect(updateMutation.mock.calls[1][0].payload).toEqual(updateMutation.mock.calls[0][0].payload)
    })

    it('does not save a changed invoice date on its own', async () => {
      // Current behavior, kept as-is in this refactor; persisting dates is a separate ticket.
      const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
      mockUpdate(updateMutation)

      renderPage()
      fireEvent.change(await screen.findByDisplayValue(format(new Date(mockInvoice.date), 'yyyy-MM-dd')), {
        target: { value: '2026-09-25' },
      })
      await waitForDebounce()

      expect(updateMutation).not.toHaveBeenCalled()
    })

    it('keeps changed invoice and due dates out of the finalize payload', async () => {
      // Current behavior, kept as-is in this refactor; persisting dates is a separate ticket.
      const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
      mockUpdate(updateMutation)
      mockFinalize(
        vi.fn().mockResolvedValue({ ...mockInvoice, status: 'FINALIZED', invoice_number: 'RE-2026-0001' }),
      )

      renderPage()
      fireEvent.change(await screen.findByDisplayValue(format(new Date(mockInvoice.date), 'yyyy-MM-dd')), {
        target: { value: '2026-09-25' },
      })
      fireEvent.change(screen.getByDisplayValue(format(new Date(mockInvoice.due_date), 'yyyy-MM-dd')), {
        target: { value: '2026-10-20' },
      })
      openFinalizeDialog()
      confirmFinalize()

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices/inv-1')
      })
      expect(Object.keys(updateMutation.mock.calls[0][0].payload).sort()).toEqual([
        'customerId',
        'items',
        'notes',
      ])
    })
  })
})
