import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePurchaseInvoice, usePayPurchaseInvoice } from '@/api/usePurchaseInvoices'
import { Button } from '@/components/ui/button'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PurchaseBillForm } from '@/components/purchase-bills/PurchaseBillForm'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { DetailSkeleton } from '@/components/ui/skeleton-presets'
import { PurchaseBillSummaryCard } from './PurchaseBillSummaryCard'

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
        return <DetailSkeleton label={t('purchaseBills.detail.loading')} />
    }

    if (error || !invoice) {
        return (
            <div className="p-6">
                <Button variant="outline" onClick={() => navigate('/purchase-bills')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t('actions.backToBills')}
                </Button>
                <Empty className="mt-4">
                    <EmptyDescription className="text-destructive">{t('purchaseBills.detail.loadFailed')}</EmptyDescription>
                </Empty>
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
                        className="bg-success hover:bg-success/90"
                        onClick={handleMarkAsPaid}
                        disabled={payMutation.isPending}
                    >
                        {payMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                        {t('actions.markAsPaid')}
                    </Button>
                )}
            </div>

            <PurchaseBillSummaryCard invoice={invoice} />
        </div>
    )
}
