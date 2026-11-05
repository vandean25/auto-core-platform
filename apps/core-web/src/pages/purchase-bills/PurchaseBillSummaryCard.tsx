import { useTranslation } from 'react-i18next'
import type { PurchaseInvoice } from '@/api/types'
import { StatusBadge } from '@/components/status/StatusBadge'
import { parseLocalDate } from '@/lib/date-utils'
import { formatCurrency, formatDate } from '@/lib/format'
import { PurchaseBillLinesTable } from './PurchaseBillLinesTable'

function BillDate({ label, value }: { label: string; value: string }) {
    const { t } = useTranslation('finance')
    const date = parseLocalDate(value)

    return (
        <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-base font-medium">
                {date ? formatDate(date) : t('placeholders.missing', { ns: 'common' })}
            </p>
        </div>
    )
}

/** Read-only summary of a posted or paid purchase bill: number, vendor, total, dates and line items. */
export function PurchaseBillSummaryCard({ invoice }: { invoice: PurchaseInvoice }) {
    const { t } = useTranslation('finance')

    return (
        <div className="bg-card rounded-lg border p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{invoice.vendor_invoice_number}</h1>
                    <p className="text-muted-foreground">{invoice.vendor?.name}</p>
                </div>
                <div className="text-right">
                    <div className="text-3xl font-bold">{formatCurrency(parseFloat(invoice.total_amount))}</div>
                    <div className="mt-1 flex justify-end">
                        <StatusBadge status={invoice.status} />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6 pt-6 border-t">
                <BillDate label={t('columns.issueDate')} value={invoice.invoice_date} />
                <BillDate label={t('columns.dueDate')} value={invoice.due_date} />
            </div>

            <PurchaseBillLinesTable lines={invoice.lines} />
        </div>
    )
}
