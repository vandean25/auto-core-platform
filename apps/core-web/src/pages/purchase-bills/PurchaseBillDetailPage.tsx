import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePurchaseInvoice, usePayPurchaseInvoice } from '@/api/usePurchaseInvoices'
import { Button } from '@/components/ui/button'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { parseLocalDate } from '@/lib/date-utils'
import { formatCurrency, formatDate } from '@/lib/format'
import { toast } from 'sonner'
import { PurchaseBillForm } from '@/components/purchase-bills/PurchaseBillForm'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ensureNamespaceLoaded } from '@/lib/i18n'

export default function PurchaseBillDetailPage() {
    const { t } = useTranslation('finance')
    useEffect(() => {
        void ensureNamespaceLoaded('finance')
    }, [])

    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { data: invoice, isLoading, error } = usePurchaseInvoice(id || '')
    useDocumentTitle(invoice?.vendor_invoice_number)
    const payMutation = usePayPurchaseInvoice()

    if (isLoading) {
        return <div className="p-6 text-center text-slate-500">{t('purchaseBills.detail.loading')}</div>
    }

    if (error || !invoice) {
        return (
            <div className="p-6">
                <Button variant="outline" onClick={() => navigate('/purchase-bills')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t('actions.backToBills')}
                </Button>
                <div className="mt-4 text-red-600">{t('purchaseBills.detail.loadFailed')}</div>
            </div>
        )
    }

    const handleMarkAsPaid = async () => {
        if (payMutation.isPending) return
        try {
            await payMutation.mutateAsync(invoice.id)
            toast.success(t('purchaseBills.detail.markedPaid'))
        } catch {
            toast.error(t('purchaseBills.detail.markPaidFailed'))
        }
    }

    if (invoice.status === 'DRAFT') {
        return (
            <PurchaseBillForm 
                initialData={invoice} 
                onSuccess={() => {}} 
                onCancel={() => navigate('/purchase-bills')} 
            />
        )
    }

    return (
        <div className="w-full max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => navigate('/purchase-bills')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t('actions.backToBills')}
                </Button>

                {invoice.status === 'POSTED' && (
                    <Button 
                        variant="default" 
                        className="bg-green-600 hover:bg-green-700"
                        onClick={handleMarkAsPaid}
                        disabled={payMutation.isPending}
                    >
                        {payMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                        {t('actions.markAsPaid')}
                    </Button>
                )}
            </div>

            <div className="bg-white rounded-lg border p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">{invoice.vendor_invoice_number}</h1>
                        <p className="text-slate-500">{invoice.vendor?.name}</p>
                    </div>
                    <div className="text-right">
                        <div className="text-3xl font-bold">
                            {formatCurrency(parseFloat(invoice.total_amount))}
                        </div>
                        <div className="mt-1 flex justify-end">
                            <StatusBadge status={invoice.status} />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6 pt-6 border-t">
                    <div>
                        <p className="text-sm text-slate-500">{t('columns.issueDate')}</p>
                        <p className="text-base font-medium">
                            {(() => {
                                const date = parseLocalDate(invoice.invoice_date)
                                return date ? formatDate(date) : t('common:placeholders.missing', { ns: 'common' })
                            })()}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm text-slate-500">{t('columns.dueDate')}</p>
                        <p className="text-base font-medium">
                            {(() => {
                                const date = parseLocalDate(invoice.due_date)
                                return date ? formatDate(date) : t('common:placeholders.missing', { ns: 'common' })
                            })()}
                        </p>
                    </div>
                </div>

                {invoice.lines && invoice.lines.length > 0 && (
                    <div className="mt-8 border-t pt-6">
                        <h2 className="text-lg font-semibold mb-4">{t('purchaseBills.detail.lineItems')}</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="border-b bg-slate-50">
                                    <tr>
                                        <th className="text-left py-2 px-4">{t('columns.description')}</th>
                                        <th className="text-right py-2 px-4">{t('columns.quantity')}</th>
                                        <th className="text-right py-2 px-4">{t('columns.unitPrice')}</th>
                                        <th className="text-right py-2 px-4">{t('columns.lineTotal')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoice.lines.map((line) => (
                                        <tr key={line.id} className="border-b">
                                            <td className="py-2 px-4">{line.description}</td>
                                            <td className="text-right py-2 px-4">{line.quantity}</td>
                                            <td className="text-right py-2 px-4">
                                                {formatCurrency(parseFloat(line.unit_price))}
                                            </td>
                                            <td className="text-right py-2 px-4">
                                                {formatCurrency(parseFloat(line.line_total))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
