import { useParams, useNavigate } from 'react-router-dom'
import { usePurchaseInvoice, usePayPurchaseInvoice } from '@/api/usePurchaseInvoices'
import { Button } from '@/components/ui/button'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { parseLocalDate } from '@/lib/date-utils'
import { toast } from 'sonner'
import { PurchaseBillForm } from '@/components/purchase-bills/PurchaseBillForm'

export default function PurchaseBillDetailPage() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { data: invoice, isLoading, error } = usePurchaseInvoice(id || '')
    const payMutation = usePayPurchaseInvoice()

    if (isLoading) {
        return <div className="p-6 text-center text-slate-500">Loading bill details...</div>
    }

    if (error || !invoice) {
        return (
            <div className="p-6">
                <Button variant="outline" onClick={() => navigate('/purchase-bills')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Bills
                </Button>
                <div className="mt-4 text-red-600">Failed to load bill. It might have been deleted.</div>
            </div>
        )
    }

    const handleMarkAsPaid = async () => {
        if (payMutation.isPending) return
        try {
            await payMutation.mutateAsync(invoice.id)
            toast.success('Bill marked as paid')
        } catch (err) {
            toast.error('Failed to mark as paid')
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
                    Back to Bills
                </Button>

                {invoice.status === 'POSTED' && (
                    <Button 
                        variant="default" 
                        className="bg-green-600 hover:bg-green-700"
                        onClick={handleMarkAsPaid}
                        disabled={payMutation.isPending}
                    >
                        {payMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                        Mark as Paid
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
                            {parseFloat(invoice.total_amount).toLocaleString('en-US', { style: 'currency', currency: 'EUR' })}
                        </div>
                        <div className="mt-1 flex justify-end">
                            <StatusBadge status={invoice.status} />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6 pt-6 border-t">
                    <div>
                        <p className="text-sm text-slate-500">Issue Date</p>
                        <p className="text-base font-medium">
                            {(() => {
                                const date = parseLocalDate(invoice.invoice_date)
                                return date ? date.toLocaleDateString() : '-'
                            })()}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm text-slate-500">Due Date</p>
                        <p className="text-base font-medium">
                            {(() => {
                                const date = parseLocalDate(invoice.due_date)
                                return date ? date.toLocaleDateString() : '-'
                            })()}
                        </p>
                    </div>
                </div>

                {invoice.lines && invoice.lines.length > 0 && (
                    <div className="mt-8 border-t pt-6">
                        <h2 className="text-lg font-semibold mb-4">Line Items</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="border-b bg-slate-50">
                                    <tr>
                                        <th className="text-left py-2 px-4">Description</th>
                                        <th className="text-right py-2 px-4">Quantity</th>
                                        <th className="text-right py-2 px-4">Unit Price</th>
                                        <th className="text-right py-2 px-4">Line Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoice.lines.map((line) => (
                                        <tr key={line.id} className="border-b">
                                            <td className="py-2 px-4">{line.description}</td>
                                            <td className="text-right py-2 px-4">{line.quantity}</td>
                                            <td className="text-right py-2 px-4">
                                                {parseFloat(line.unit_price).toLocaleString('en-US', { style: 'currency', currency: 'EUR' })}
                                            </td>
                                            <td className="text-right py-2 px-4">
                                                {parseFloat(line.line_total).toLocaleString('en-US', { style: 'currency', currency: 'EUR' })}
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
