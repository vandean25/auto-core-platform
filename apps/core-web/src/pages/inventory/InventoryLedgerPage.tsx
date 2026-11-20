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
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { InventoryLedgerCard } from './InventoryLedgerCard'
import { NotFoundCard } from '@/pages/not-found/NotFoundCard'
import { getErrorStatus } from '@/lib/error-utils'

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

  const { data: detailItem, isLoading: isDetailLoading, error: detailError } = useInventoryItem(itemId)
  const { data: fetchedListItem, isLoading: isListItemLoading } = useInventoryItemBySku(sku, itemId)
  const item = detailItem ?? fetchedListItem ?? null

  const { data: transactions, isLoading: isLedgerLoading, error: ledgerError } = useInventoryHistory(itemId)
  const isItemLoading = isDetailLoading || isListItemLoading

  if (!isItemLoading && getErrorStatus(detailError) === 404) {
    return <NotFoundCard />
  }

  return (
    <div className="space-y-6">
      <motion.div
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.25 } }}
      >
        <Button variant="ghost" size="sm" className="self-start max-sm:min-h-11" asChild>
          <Link to="/inventory">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('ledger.backToInventory')}
          </Link>
        </Button>
        {canManage && item ? (
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
            <Button variant="outline" size="sm" className="max-sm:min-h-11 max-sm:px-2" onClick={() => setReceiveOpen(true)}>
              {t('actions.receive')}
            </Button>
            <Button variant="outline" size="sm" className="max-sm:min-h-11 max-sm:px-2" onClick={() => setAdjustOpen(true)}>
              {t('actions.adjust')}
            </Button>
            <Button
              size="sm"
              className="max-sm:min-h-11 max-sm:px-2"
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
            <InventoryLedgerCard transactions={transactions} isLoading={isLedgerLoading} error={ledgerError} />
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
