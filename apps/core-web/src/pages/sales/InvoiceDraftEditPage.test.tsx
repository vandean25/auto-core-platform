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
})
