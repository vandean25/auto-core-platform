import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUpdateSalesOrder } from '@/api/sales-orders'
import type { SalesOrder } from '@/api/types'
import { translateSalesApiError } from '@/features/sales/sales-api-error-i18n'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { queueInvoiceDraftCreate } from '@/pages/sales/useInvoicePendingCreate'

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
  const updateSalesOrder = useUpdateSalesOrder()
  const handingOff = useRef(false)
  const [handingOffInvoice, setHandingOffInvoice] = useState(false)

  const createInvoice = (order: SalesOrder) => {
    if (handingOff.current) return
    handingOff.current = true
    setHandingOffInvoice(true)
    const customer = order.customer
    const customerName =
      customer.type === 'COMPANY' && customer.company_name
        ? customer.company_name
        : `${customer.first_name} ${customer.last_name}`.trim()
    queueInvoiceDraftCreate({ orderId: id, customerName })
    navigate(APP_ROUTE_PATHS.salesInvoices, { replace: true })
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

  return { createInvoice, saveNotes, handingOffInvoice }
}
