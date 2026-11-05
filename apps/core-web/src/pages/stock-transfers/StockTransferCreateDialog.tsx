import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useCreateStockTransfer } from '@/api/stock-transfers'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getErrorMessage } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import {
  DraftLineRow,
  PartSearch,
  SiteSelect,
  toTransferPayloadLines,
  transferDraftBlocker,
} from './stock-transfer-create-parts'
import { useStockTransferCreateForm } from './useStockTransferCreateForm'

type StockTransferCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function StockTransferCreateDialog({
  open,
  onOpenChange,
}: StockTransferCreateDialogProps) {
  const { t } = useTranslation(['inventory', 'common'])
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const navigate = useNavigate()
  const createTransfer = useCreateStockTransfer()
  const form = useStockTransferCreateForm(open)
  const { fromSiteId, toSiteId, lines, showSourceBin } = form

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) form.reset()
    onOpenChange(nextOpen)
  }

  const handleSubmit = async () => {
    const blocker = transferDraftBlocker(fromSiteId, toSiteId, lines, t)
    if (blocker) {
      toast.error(blocker)
      return
    }

    try {
      const transfer = await createTransfer.mutateAsync({
        fromSiteId,
        toSiteId,
        lines: toTransferPayloadLines(lines, showSourceBin, t),
      })
      toast.success(t('inventory:stockTransfers.create.success'))
      handleClose(false)
      navigate(`/stock-transfers/${transfer.id}`)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('inventory:stockTransfers.create.failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent fullScreenOnPhone className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('inventory:stockTransfers.create.title')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <SiteSelect
            id="transfer-from-site"
            label={t('inventory:stockTransfers.create.fromSite')}
            placeholder={t('inventory:stockTransfers.create.selectSourceSite')}
            value={fromSiteId}
            onChange={form.setFromSiteId}
            sites={form.availableFromSites}
          />
          <SiteSelect
            id="transfer-to-site"
            label={t('inventory:stockTransfers.create.toSite')}
            placeholder={t('inventory:stockTransfers.create.selectDestSite')}
            value={toSiteId}
            onChange={form.setToSiteId}
            sites={form.availableToSites}
          />
        </div>

        <PartSearch
          query={form.searchQuery}
          onQueryChange={form.setSearchQuery}
          isSearching={form.isSearchingInventory}
          results={form.inventoryResults}
          onPick={form.addLine}
        />

        {lines.length > 0 ? (
          <div className="mt-4 space-y-3 rounded-md border border-border p-3">
            {lines.map((line) => (
              <DraftLineRow
                key={line.catalogItemId}
                line={line}
                showSourceBin={showSourceBin}
                sourceBins={form.sourceBins}
                onChange={(patch) => form.updateLine(line.catalogItemId, patch)}
              />
            ))}
          </div>
        ) : null}

        <DialogFooter className="max-sm:gap-2">
          <Button variant="outline" onClick={() => handleClose(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={createTransfer.isPending}>
            {createTransfer.isPending
              ? t('inventory:actions.submitting')
              : t('inventory:actions.submitRequest')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
