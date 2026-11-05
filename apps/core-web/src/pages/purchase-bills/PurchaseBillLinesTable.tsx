import { useTranslation } from 'react-i18next'
import type { PurchaseInvoice } from '@/api/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/format'

/** Line items of a posted purchase bill; renders nothing when the bill has none. */
export function PurchaseBillLinesTable({ lines }: { lines: PurchaseInvoice['lines'] }) {
    const { t } = useTranslation('finance')

    if (!lines || lines.length === 0) return null

    return (
        <div className="mt-8 border-t pt-6">
            <h2 className="text-lg font-semibold mb-4">{t('purchaseBills.detail.lineItems')}</h2>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('columns.description')}</TableHead>
                        <TableHead className="text-right">{t('columns.quantity')}</TableHead>
                        <TableHead className="text-right">{t('columns.unitPrice')}</TableHead>
                        <TableHead className="text-right">{t('columns.lineTotal')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {lines.map((line) => (
                        <TableRow key={line.id}>
                            <TableCell>{line.description}</TableCell>
                            <TableCell className="text-right">{line.quantity}</TableCell>
                            <TableCell className="text-right">{formatCurrency(parseFloat(line.unit_price))}</TableCell>
                            <TableCell className="text-right">{formatCurrency(parseFloat(line.line_total))}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
