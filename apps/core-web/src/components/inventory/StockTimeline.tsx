import { useInventoryHistory } from '@/api/inventory'
import type { TransactionType } from '@/api/types'
import { PlusCircle, MinusCircle, RefreshCcw, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StockTimelineProps {
    itemId: string
}

const getTransactionIcon = (type: TransactionType) => {
    switch (type) {
        case 'PURCHASE_RECEIPT':
        case 'TRANSFER_IN':
        case 'INITIAL_BALANCE':
            return <PlusCircle className="h-5 w-5 text-green-600" />
        case 'SALE_ISSUE':
        case 'TRANSFER_OUT':
            return <MinusCircle className="h-5 w-5 text-red-600" />
        case 'ADJUSTMENT':
            return <RefreshCcw className="h-5 w-5 text-gray-600" />
    }
}

const getTransactionTitle = (type: TransactionType, referenceId: string | null) => {
    const titles: Record<TransactionType, string> = {
        PURCHASE_RECEIPT: 'Purchase Receipt',
        SALE_ISSUE: 'Sale Issue',
        ADJUSTMENT: 'Inventory Adjustment',
        TRANSFER_IN: 'Transfer In',
        TRANSFER_OUT: 'Transfer Out',
        INITIAL_BALANCE: 'Initial Balance',
    }

    const title = titles[type]
    return referenceId ? `${title} (${referenceId})` : title
}

const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(date)
}

export default function StockTimeline({ itemId }: StockTimelineProps) {
    const { data: transactions, isLoading, error } = useInventoryHistory(itemId)

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="text-center py-12 text-slate-500">
                <p>Failed to load transaction history</p>
            </div>
        )
    }

    if (!transactions || transactions.length === 0) {
        return (
            <div className="text-center py-12 text-slate-500">
                <p>No transaction history available</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {transactions.map((transaction, index) => {
                const isLast = index === transactions.length - 1
                const quantity = parseFloat(transaction.quantity)
                const isPositive = quantity > 0

                return (
                    <div key={transaction.id} className="relative flex gap-4">
                        {/* Timeline line */}
                        {!isLast && (
                            <div className="absolute left-[10px] top-8 bottom-0 w-0.5 bg-gray-200" />
                        )}

                        {/* Icon */}
                        <div className="relative z-10 flex-shrink-0 mt-0.5">
                            {getTransactionIcon(transaction.type)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 pb-6">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                    <p className="font-medium text-slate-900">
                                        {getTransactionTitle(transaction.type, transaction.reference_id)}
                                    </p>
                                    <p className="text-sm text-slate-500 mt-0.5">
                                        {transaction.location.name}
                                    </p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <Badge
                                        variant={isPositive ? 'default' : 'destructive'}
                                        className={cn(
                                            'font-mono',
                                            isPositive && 'bg-green-100 text-green-800 hover:bg-green-100'
                                        )}
                                    >
                                        {isPositive ? '+' : ''}{quantity}
                                    </Badge>
                                    <span className="text-xs text-slate-400">
                                        {formatDate(transaction.createdAt)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
