import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useReverseInventoryTransaction } from '@/api/inventory'
import type { InventoryTransaction } from '@/api/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getErrorMessage } from '@/lib/error-utils'
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format'
import {
  formatInventoryTransactionType,
  formatStockAdjustmentReason,
} from '@/lib/i18n/enum-labels'

type InventoryLedgerCardProps = {
  itemId?: string
  canManage?: boolean
  transactions: InventoryTransaction[] | undefined
  isLoading: boolean
  error: unknown
}

function formatUnitCost(costBasis: string | null | undefined, emDash: string): string {
  if (costBasis === null || costBasis === undefined) return emDash
  return `${formatNumber(costBasis, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`
}

function formatExtendedValue(extendedValue: string | null | undefined, emDash: string): string {
  if (extendedValue === null || extendedValue === undefined) return emDash
  return formatCurrency(extendedValue)
}

function formatReasonCell(transaction: InventoryTransaction, emDash: string): string {
  if (!transaction.reason) {
    return transaction.note ? transaction.note : emDash
  }
  const label = formatStockAdjustmentReason(transaction.reason)
  return transaction.note ? `${label} — ${transaction.note}` : label
}

function canReverseTransaction(transaction: InventoryTransaction, canManage: boolean, itemId?: string): boolean {
  return Boolean(
    canManage &&
      itemId &&
      transaction.type === 'ADJUSTMENT' &&
      !transaction.reversal_of_transaction_id &&
      !transaction.reversed_by_transaction_id,
  )
}

function TransactionBadges({ transaction }: { transaction: InventoryTransaction }) {
  const { t } = useTranslation('inventory')
  return (
    <>
      {transaction.reversal_of_transaction_id ? (
        <Badge variant="secondary">{t('ledger.reversalOfBadge')}</Badge>
      ) : null}
      {transaction.reversed_by_transaction_id ? (
        <Badge variant="outline">{t('ledger.reversedBadge')}</Badge>
      ) : null}
    </>
  )
}

function InventoryLedgerMobileList({
  transactions,
  canManage,
  itemId,
  emDash,
  onReverseClick,
}: {
  transactions: InventoryTransaction[]
  canManage: boolean
  itemId?: string
  emDash: string
  onReverseClick: (id: string) => void
}) {
  const { t } = useTranslation('inventory')
  return (
    <ul data-testid="inventory-ledger-mobile-list" className="divide-y divide-border sm:hidden">
      {transactions.map((transaction) => {
        const quantity = Number(transaction.quantity)
        const reversible = canReverseTransaction(transaction, canManage, itemId)
        return (
          <li key={transaction.id} className="space-y-1.5 px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-foreground">
                  {formatInventoryTransactionType(transaction.type)}
                </span>
                <TransactionBadges transaction={transaction} />
              </div>
              <span className="font-semibold tabular-nums">
                {quantity > 0 ? '+' : ''}
                {quantity}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>{formatDateTime(transaction.createdAt)}</span>
              <span className="tabular-nums">
                {t('ledger.columns.cost')}: {formatUnitCost(transaction.cost_basis, emDash)} ·{' '}
                {t('ledger.columns.value')}: {formatExtendedValue(transaction.extended_value, emDash)}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                {t('ledger.columns.reason')}:{' '}
                <span className="text-foreground">{formatReasonCell(transaction, emDash)}</span>
              </span>
              <span>
                {t('ledger.columns.reference')}:{' '}
                <span className="text-foreground">{transaction.reference_id ?? emDash}</span>
              </span>
              <span>
                {t('ledger.columns.location')}:{' '}
                <span className="text-foreground">{transaction.location?.name ?? emDash}</span>
              </span>
            </div>
            {reversible ? (
              <div className="pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => onReverseClick(transaction.id)}
                >
                  {t('ledger.reverseAction')}
                </Button>
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function InventoryLedgerTable({
  transactions,
  emptyOrStatusMessage,
  canManage,
  itemId,
  emDash,
  onReverseClick,
}: {
  transactions: InventoryTransaction[] | undefined
  emptyOrStatusMessage: string | null
  canManage: boolean
  itemId?: string
  emDash: string
  onReverseClick: (id: string) => void
}) {
  const { t } = useTranslation('inventory')
  const showActions = Boolean(canManage && itemId)

  return (
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
            <TableHead className="text-right">{t('ledger.columns.value')}</TableHead>
            <TableHead>{t('ledger.columns.reason')}</TableHead>
            {showActions ? <TableHead className="text-right">{t('ledger.columns.actions')}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {emptyOrStatusMessage ? (
            <TableRow>
              <TableCell colSpan={showActions ? 9 : 8} className="py-6 text-center text-muted-foreground">
                {emptyOrStatusMessage}
              </TableCell>
            </TableRow>
          ) : (
            transactions!.map((transaction) => {
              const quantity = Number(transaction.quantity)
              const reversible = canReverseTransaction(transaction, canManage, itemId)
              return (
                <TableRow key={transaction.id}>
                  <TableCell>{formatDateTime(transaction.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{formatInventoryTransactionType(transaction.type)}</span>
                      <TransactionBadges transaction={transaction} />
                    </div>
                  </TableCell>
                  <TableCell>{transaction.reference_id ?? emDash}</TableCell>
                  <TableCell>{transaction.location?.name ?? emDash}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {quantity > 0 ? '+' : ''}
                    {quantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUnitCost(transaction.cost_basis, emDash)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatExtendedValue(transaction.extended_value, emDash)}
                  </TableCell>
                  <TableCell>{formatReasonCell(transaction, emDash)}</TableCell>
                  {showActions ? (
                    <TableCell className="text-right">
                      {reversible ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onReverseClick(transaction.id)}
                        >
                          {t('ledger.reverseAction')}
                        </Button>
                      ) : (
                        emDash
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function InventoryLedgerCard({
  itemId,
  canManage = false,
  transactions,
  isLoading,
  error,
}: InventoryLedgerCardProps) {
  const { t } = useTranslation('inventory')
  const emDash = t('shared.emDash')
  const [reverseTargetId, setReverseTargetId] = React.useState<string | null>(null)
  const reverseMutation = useReverseInventoryTransaction(itemId ?? '')

  const emptyOrStatusMessage = isLoading
    ? t('ledger.loadingLedger')
    : error
      ? t('ledger.loadLedgerFailed')
      : !transactions || transactions.length === 0
        ? t('ledger.noLedgerActivity')
        : null

  const handleConfirmReverse = async () => {
    if (!reverseTargetId) return
    try {
      await reverseMutation.mutateAsync(reverseTargetId)
      toast.success(t('ledger.reverseSuccess'))
      setReverseTargetId(null)
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('ledger.reverseFailed')))
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('ledger.stockLedgerTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {emptyOrStatusMessage ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:hidden">{emptyOrStatusMessage}</p>
        ) : (
          <InventoryLedgerMobileList
            transactions={transactions!}
            canManage={canManage}
            itemId={itemId}
            emDash={emDash}
            onReverseClick={setReverseTargetId}
          />
        )}

        <InventoryLedgerTable
          transactions={transactions}
          emptyOrStatusMessage={emptyOrStatusMessage}
          canManage={canManage}
          itemId={itemId}
          emDash={emDash}
          onReverseClick={setReverseTargetId}
        />
      </CardContent>

      <AlertDialog open={Boolean(reverseTargetId)} onOpenChange={(next) => { if (!next) setReverseTargetId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ledger.reverseConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ledger.reverseConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.keepRequest')}</AlertDialogCancel>
            <AlertDialogAction disabled={reverseMutation.isPending} onClick={() => void handleConfirmReverse()}>
              {t('ledger.reverseAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
