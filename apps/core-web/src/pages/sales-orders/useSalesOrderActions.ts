import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useCreateInvoiceFromOrder, useUpdateSalesOrder } from '@/api/sales-orders'
import type { SalesOrder } from '@/api/types'
import { translateSalesApiError } from '@/features/sales/sales-api-error-i18n'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'

/** True once the sales translations are loaded (they load lazily with the route). */
export function useSalesLocaleReady() {
  const [ready, setReady] = useState(() => i18n.hasResourceBundle(i18n.language, 'sales'))
  useEffect(() => {
    if (ready) return
    void ensureNamespaceLoaded('sales').then(() => setReady(true))
  }, [ready])
  return ready
}

/** Create-invoice and save-notes handlers of the sales order detail page. */
export function useSalesOrderActions(id: string) {
  const { t } = useTranslation('sales')
  const navigate = useNavigate()
  const createInvoiceMutation = useCreateInvoiceFromOrder()
  const updateSalesOrder = useUpdateSalesOrder()

  const createInvoice = async () => {
    try {
      const invoice = await createInvoiceMutation.mutateAsync(id)
      toast.success(t('orders.detail.invoiceDraftCreated'))
      navigate(`/sales/invoices/${invoice.id}/edit`)
    } catch (error: unknown) {
      toast.error(translateSalesApiError(t, error, 'errors.generic'))
    }
  }

  const saveNotes = async (order: SalesOrder, nextNotes: string) => {
    if (order.status === 'INVOICED') return
    if (nextNotes === (order.notes ?? '')) return

    try {
      await updateSalesOrder.mutateAsync({
        id: order.id,
        data: { notes: nextNotes },
      })
      toast.success(t('orders.detail.notesSaved'))
    } catch (error: unknown) {
      toast.error(translateSalesApiError(t, error, 'errors.generic'))
      throw error
    }
  }

  return { createInvoice, saveNotes }
}
