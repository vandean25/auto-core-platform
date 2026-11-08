import { useTranslation } from 'react-i18next'

import { formatInvoiceCustomerName } from '@/api/invoice-list'
import type { Invoice } from '@/api/types'
import { DataTablePendingIcon, InteractionErrorMarker, isDataTablePendingRow } from '@/components/data-table/data-table-states'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { PendingCreateRow } from '@/features/interaction/use-list-pending-create'
import { formatDateShort } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'

export function InvoiceNumberCell({ invoice }: { invoice: Invoice }) {
  const { t } = useTranslation(['sales', 'common'])
  if (isDataTablePendingRow(invoice)) {
    return <DataTablePendingIcon label={t('common:dataTable.loading.pendingRow')} />
  }
  return (
    <div className="font-medium">
      {invoice.invoice_number ?? t('sales:shared.draftLabel', { id: invoice.id.slice(0, 8) })}
    </div>
  )
}

export function InvoiceDateCell({ invoice }: { invoice: Invoice }) {
  if (isDataTablePendingRow(invoice) || !invoice.date) return null
  return <div>{formatDateShort(invoice.date)}</div>
}

export function InvoiceCustomerCell({
  invoice,
  onDismiss,
}: {
  invoice: Invoice
  onDismiss: (localId: string) => void
}) {
  const failure = (invoice as PendingCreateRow<Invoice>).pendingFailure
  return (
    <div>
      <div>{formatInvoiceCustomerName(invoice)}</div>
      {failure ? <InteractionErrorMarker message={failure} onDismiss={() => onDismiss(invoice.id)} /> : null}
    </div>
  )
}

export function InvoiceStatusCell({ invoice }: { invoice: Invoice }) {
  if (isDataTablePendingRow(invoice)) return null
  return <StatusBadge status={invoice.status} />
}

export function InvoiceTotalCell({ invoice }: { invoice: Invoice }) {
  if (isDataTablePendingRow(invoice) || invoice.total_gross === '' || invoice.total_gross == null) return null
  return <div className="text-right font-medium">{formatCurrency(Number(invoice.total_gross))}</div>
}
