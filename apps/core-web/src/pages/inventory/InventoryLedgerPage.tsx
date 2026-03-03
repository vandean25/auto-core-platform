import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import type { InventoryItem, TransactionType } from '@/api/types'
import { useInventoryHistory, useInventoryItemBySku } from '@/api/inventory'
import { InventoryItemInfoCard } from '@/components/inventory/InventoryItemInfoCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

const transactionLabels: Record<TransactionType, string> = {
  PURCHASE_RECEIPT: 'Purchase Receipt',
  SALE_ISSUE: 'Sale Issue',
  ADJUSTMENT: 'Adjustment',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
  INITIAL_BALANCE: 'Initial Balance',
}

const formatLedgerDate = (dateString: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString))

export default function InventoryLedgerPage() {
  const { itemId = '' } = useParams<{ itemId: string }>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const sku = searchParams.get('sku') ?? undefined
  const stateItem = (location.state as { item?: InventoryItem } | null)?.item

  const { data: fetchedItem, isLoading: isItemLoading } = useInventoryItemBySku(sku, itemId)
  const item = fetchedItem ?? stateItem ?? null

  const { data: transactions, isLoading: isLedgerLoading, error: ledgerError } = useInventoryHistory(itemId)

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.25 } }}
      >
        <Button variant="ghost" size="sm" asChild>
          <Link to="/inventory">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Inventory
          </Link>
        </Button>
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
                <CardTitle className="text-base font-semibold">Item Info</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {isItemLoading ? 'Loading item details...' : 'Item details unavailable.'}
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
                <CardTitle className="text-base font-semibold">Stock Ledger</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLedgerLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                          Loading ledger...
                        </TableCell>
                      </TableRow>
                    ) : ledgerError ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                          Failed to load ledger.
                        </TableCell>
                      </TableRow>
                    ) : !transactions || transactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                          No ledger activity yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      transactions.map((transaction) => {
                        const quantity = Number(transaction.quantity)
                        const costValue =
                          transaction.cost_basis === null || transaction.cost_basis === undefined
                            ? null
                            : Number(transaction.cost_basis)
                        const transactionTypeLabel =
                          transactionLabels[transaction.type]?.trim() || transaction.type || 'Unknown'
                        return (
                          <TableRow key={transaction.id}>
                            <TableCell>{formatLedgerDate(transaction.createdAt)}</TableCell>
                            <TableCell>{transactionTypeLabel}</TableCell>
                            <TableCell>{transaction.reference_id ?? '—'}</TableCell>
                            <TableCell>{transaction.location?.name ?? '—'}</TableCell>
                            <TableCell className="text-right">
                              {quantity > 0 ? '+' : ''}
                              {quantity}
                            </TableCell>
                            <TableCell className="text-right">
                              {costValue === null ? '—' : formatCurrency(costValue)}
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
    </div>
  )
}
