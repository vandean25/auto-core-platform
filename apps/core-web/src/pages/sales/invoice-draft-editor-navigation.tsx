import { useEffect } from 'react'
import { useNavigate, type NavigateFunction } from 'react-router-dom'

import { DATA_TABLE_URL_SYNC_DEBOUNCE_MS } from '@/hooks/useDataTableQuery'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

const INVOICE_DRAFT_EDITOR_NAV_EVENT = 'acp:open-invoice-draft-editor'

let navigateRef: NavigateFunction | null = null

function openInvoiceDraftEditor(invoiceId: string) {
  const target = APP_ROUTE_PATHS.salesInvoiceEdit.replace(':id', invoiceId)
  const run = () => {
    navigateRef?.(target, { replace: true })
  }
  if (navigateRef) {
    // Let the invoice list finish URL sync (useSearchParams replace) before opening the draft editor.
    window.setTimeout(run, DATA_TABLE_URL_SYNC_DEBOUNCE_MS + 50)
    return
  }
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(INVOICE_DRAFT_EDITOR_NAV_EVENT, { detail: { invoiceId } }))
}

export function requestInvoiceDraftEditorNavigation(invoiceId: string) {
  if (!invoiceId) return
  openInvoiceDraftEditor(invoiceId)
}

/** Opens the sales-invoice draft editor from list pending create (mounted for the full authenticated session). */
export function InvoiceDraftEditorNavigationHost() {
  const navigate = useNavigate()
  navigateRef = navigate

  useEffect(() => {
    return () => {
      if (navigateRef === navigate) navigateRef = null
    }
  }, [navigate])

  useEffect(() => {
    const openEditor = (event: Event) => {
      const invoiceId = (event as CustomEvent<{ invoiceId: string }>).detail.invoiceId
      if (!invoiceId) return
      openInvoiceDraftEditor(invoiceId)
    }

    window.addEventListener(INVOICE_DRAFT_EDITOR_NAV_EVENT, openEditor)
    return () => window.removeEventListener(INVOICE_DRAFT_EDITOR_NAV_EVENT, openEditor)
  }, [])

  return null
}
