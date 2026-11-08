import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useCreateInvoiceFromOrder } from '@/api/sales-orders'
import type { Invoice } from '@/api/types'
import { describePendingCreateError, useListPendingCreate } from '@/features/interaction/use-list-pending-create'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

export type InvoiceDraftCreateRequest = {
  orderId: string
  customerName: string
}

let queuedCreate: InvoiceDraftCreateRequest | null = null

/** Hands a sales-order draft to the invoice list. A second handoff for the same order is ignored. */
export function queueInvoiceDraftCreate(request: InvoiceDraftCreateRequest) {
  if (queuedCreate?.orderId === request.orderId) return
  queuedCreate = request
}

export function takeQueuedInvoiceDraftCreate() {
  const request = queuedCreate
  queuedCreate = null
  return request
}

/** Presentation-only row: the customer name, no number, price or actions. */
function buildPendingInvoice(localId: string, payload: InvoiceDraftCreateRequest): Invoice {
  return {
    id: localId,
    status: 'DRAFT',
    customer_id: '',
    customer: {
      id: '',
      type: 'PRIVATE',
      first_name: payload.customerName,
      last_name: '',
    },
    date: '',
    due_date: '',
    total_net: '',
    total_tax: '',
    total_gross: '',
    items: [],
    invoice_number: null,
    sales_order_id: payload.orderId,
  } as Invoice
}

/** Sales-invoice draft creation stays server-confirmed behind a pending list row (ADR-0036 R1). */
export function useInvoicePendingCreate(serverRows: Invoice[], dataUpdatedAt: number) {
  const { t } = useTranslation('sales')
  const navigate = useNavigate()
  const createInvoice = useCreateInvoiceFromOrder()
  const pending = useListPendingCreate<InvoiceDraftCreateRequest, Invoice>({
    create: (payload) => createInvoice.mutateAsync(payload.orderId),
    buildRow: buildPendingInvoice,
    serverRows,
    dataUpdatedAt,
    describeError: (error) =>
      describePendingCreateError(error, {
        unconfirmed: t('invoices.list.createUnconfirmed'),
        failed: t('invoices.list.createFailed'),
      }),
    onCreated: (created) => {
      toast.success(t('orders.detail.invoiceDraftCreated'))
      navigate(APP_ROUTE_PATHS.salesInvoiceEdit.replace(':id', created.id))
    },
  })

  const { submit } = pending
  useEffect(() => {
    const request = takeQueuedInvoiceDraftCreate()
    if (request) submit(request)
  }, [submit])

  return pending
}
