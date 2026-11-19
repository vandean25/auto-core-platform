import { useTranslation } from 'react-i18next'
import type { InventoryTransaction } from '@/api/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { formatInventoryTransactionType } from '@/lib/i18n/enum-labels'

type InventoryLedgerCardProps = {
  transactions: InventoryTransaction[] | undefined
  isLoading: boolean
  error: unknown
}

export function InventoryLedgerCard({ transactions, isLoading, error }: InventoryLedgerCardProps) {
  const { t } = useTranslation('inventory')
  const emDash = t('shared.emDash')

  const emptyOrStatusMessage = isLoading
    ? t('ledger.loadingLedger')
    : error
      ? t('ledger.loadLedgerFailed')
      : !transactions || transactions.length === 0
        ? t('ledger.noLedgerActivity')
        : null

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('ledger.stockLedgerTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {emptyOrStatusMessage ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:hidden">{emptyOrStatusMessage}</p>
        ) : (
          <ul data-testid="inventory-ledger-mobile-list" className="divide-y divide-border sm:hidden">
            {transactions!.map((transaction) => {
              const quantity = Number(transaction.quantity)
              const costValue =
                transaction.cost_basis === null || transaction.cost_basis === undefined
                  ? null
                  : Number(transaction.cost_basis)
              return (
                <li key={transaction.id} className="space-y-1.5 px-4 py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">{formatInventoryTransactionType(transaction.type)}</span>
                    <span className="font-semibold tabular-nums">
                      {quantity > 0 ? '+' : ''}
                      {quantity}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatDateTime(transaction.createdAt)}</span>
                    <span className="tabular-nums">{costValue === null ? emDash : formatCurrency(costValue)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {t('ledger.columns.reference')}: <span className="text-foreground">{transaction.reference_id ?? emDash}</span>
                    </span>
                    <span>
                      {t('ledger.columns.location')}: <span className="text-foreground">{transaction.location?.name ?? emDash}</span>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <div className="hidden sm:block">
          <Table scrollCue data-testid="inventory-ledger-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('ledger.columns.date')}</TableHead>
                <TableHead>{t('ledger.columns.type')}</TableHead>
                <TableHead>{t('ledger.columns.reference')}</TableHead>
                <TableHead>{t('ledger.columns.location')}</TableHead>
                <TableHead className="text-right">{t('ledger.columns.qty')}</TableHead>
                <TableHead className="text-right">{t('ledger.columns.cost')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emptyOrStatusMessage ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {emptyOrStatusMessage}
                  </TableCell>
                </TableRow>
              ) : (
                transactions!.map((transaction) => {
                  const quantity = Number(transaction.quantity)
                  const costValue =
                    transaction.cost_basis === null || transaction.cost_basis === undefined
                      ? null
                      : Number(transaction.cost_basis)
                  return (
                    <TableRow key={transaction.id}>
                      <TableCell>{formatDateTime(transaction.createdAt)}</TableCell>
                      <TableCell>{formatInventoryTransactionType(transaction.type)}</TableCell>
                      <TableCell>{transaction.reference_id ?? emDash}</TableCell>
                      <TableCell>{transaction.location?.name ?? emDash}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {quantity > 0 ? '+' : ''}
                        {quantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {costValue === null ? emDash : formatCurrency(costValue)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
