import * as React from 'react'
import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import { useInventoryHistory, useInventoryItem, useInventoryItemBySku } from '@/api/inventory'
import { useAuthSession } from '@/api/auth-session'
import { AdjustInventoryStockDialog } from '@/components/inventory/AdjustInventoryStockDialog'
import { EditInventoryItemDialog } from '@/components/inventory/EditInventoryItemDialog'
import { ReceiveInventoryStockDialog } from '@/components/inventory/ReceiveInventoryStockDialog'
import { InventoryItemInfoCard } from '@/components/inventory/InventoryItemInfoCard'
import { canManageInventoryItems } from '@/features/inventory/inventory-management-permissions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { formatInventoryTransactionType } from '@/lib/i18n/enum-labels'

const formatLedgerDate = (dateString: string) => formatDateTime(dateString)

export default function InventoryLedgerPage() {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const { itemId = '' } = useParams<{ itemId: string }>()
  const [searchParams] = useSearchParams()
  const sku = searchParams.get('sku') ?? undefined
  const sessionQuery = useAuthSession()
  const canManage = canManageInventoryItems(sessionQuery.data?.activeRole)
  const [receiveOpen, setReceiveOpen] = React.useState(false)
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)

  const { data: detailItem, isLoading: isDetailLoading } = useInventoryItem(itemId)
  const { data: fetchedListItem, isLoading: isListItemLoading } = useInventoryItemBySku(sku, itemId)
  const item = detailItem ?? fetchedListItem ?? null

  const { data: transactions, isLoading: isLedgerLoading, error: ledgerError } = useInventoryHistory(itemId)
  const isItemLoading = isDetailLoading || isListItemLoading
  const emDash = t('shared.emDash')

  return (
    <div className="space-y-6">
      <motion.div
        className="flex items-center justify-between gap-4"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.25 } }}
      >
        <Button variant="ghost" size="sm" asChild>
          <Link to="/inventory">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('ledger.backToInventory')}
          </Link>
        </Button>
        {canManage && item ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setReceiveOpen(true)}>
              {t('actions.receive')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAdjustOpen(true)}>
              {t('actions.adjust')}
            </Button>
            <Button
              size="sm"
              disabled={!detailItem || isDetailLoading}
              onClick={() => setEditOpen(true)}
            >
              {t('actions.edit')}
            </Button>
          </div>
        ) : null}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
        <div className="lg:col-span-2">
          {item ? (
            <motion.div layoutId="item-info-card" transition={{ duration: 0.35, ease: 'easeInOut' }}>
              <InventoryItemInfoCard
                item={item}
                variant="expanded"
                className="h-full flex flex-col"
                contentClassName="flex-1"
              />
            </motion.div>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">{t('ledger.itemInfoTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {isItemLoading ? t('ledger.loadingItemDetails') : t('ledger.itemDetailsUnavailable')}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-3">
          <motion.div
            className="h-full"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.35 } }}
          >
            <Card className="h-full flex flex-col">
              <CardHeader>
                <CardTitle className="text-base font-semibold">{t('ledger.stockLedgerTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-x-auto">
                <Table className="min-w-[720px]">
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
                    {isLedgerLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                          {t('ledger.loadingLedger')}
                        </TableCell>
                      </TableRow>
                    ) : ledgerError ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                          {t('ledger.loadLedgerFailed')}
                        </TableCell>
                      </TableRow>
                    ) : !transactions || transactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                          {t('ledger.noLedgerActivity')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      transactions.map((transaction) => {
                        const quantity = Number(transaction.quantity)
                        const costValue =
                          transaction.cost_basis === null || transaction.cost_basis === undefined
                            ? null
                            : Number(transaction.cost_basis)
                        const transactionTypeLabel = formatInventoryTransactionType(transaction.type)
                        return (
                          <TableRow key={transaction.id}>
                            <TableCell>{formatLedgerDate(transaction.createdAt)}</TableCell>
                            <TableCell>{transactionTypeLabel}</TableCell>
                            <TableCell>{transaction.reference_id ?? emDash}</TableCell>
                            <TableCell>{transaction.location?.name ?? emDash}</TableCell>
                            <TableCell className="text-right">
                              {quantity > 0 ? '+' : ''}
                              {quantity}
                            </TableCell>
                            <TableCell className="text-right">
                              {costValue === null ? emDash : formatCurrency(costValue)}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>

      {item && canManage ? (
        <>
          <ReceiveInventoryStockDialog itemId={itemId} open={receiveOpen} onOpenChange={setReceiveOpen} />
          <AdjustInventoryStockDialog itemId={itemId} open={adjustOpen} onOpenChange={setAdjustOpen} />
          {detailItem ? (
            <EditInventoryItemDialog
              item={detailItem}
              open={editOpen}
              onOpenChange={setEditOpen}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
