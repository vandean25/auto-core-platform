import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useBulkAdjustInventoryPrices, type BulkPriceResult } from '@/api/inventory'
import type { InventoryItem } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mapRegistryActionsToPalette } from '@/components/global-search/global-search-context-actions'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import { MAX_BULK_INVENTORY_ITEMS, createInventoryBulkActions } from '@/features/actions/inventory-bulk-actions'
import { publishSelectionPaletteSection } from '@/features/actions/selection-palette-store'
import { useAuthRole } from '@/features/actions/use-auth-role'

const MIN_PERCENT = -50
const MAX_PERCENT = 100

function parsePercent(raw: string): number | null {
  const value = Number(raw.replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(value) && value !== 0 && value >= MIN_PERCENT && value <= MAX_PERCENT ? value : null
}

/** What the server refused or failed, per part. A partial result keeps the dialog open so nothing is missed. */
function BulkPriceResultAlert({ result }: { result: BulkPriceResult }) {
  const { t } = useTranslation('inventory')
  return (
    <div role="alert" className="space-y-1 text-sm text-destructive">
      <p>{t('bulk.adjustPrice.result', { updated: result.updated, total: result.total })}</p>
      <ul className="list-disc pl-5">
        {result.failed.map((failure) => (
          <li key={failure.id}>
            {t('bulk.adjustPrice.failedItem', {
              sku: failure.sku,
              reason: failure.forbidden ? t('bulk.adjustPrice.reasonForbidden') : t('bulk.adjustPrice.reasonFailed'),
            })}
          </li>
        ))}
      </ul>
      {result.failed.some((failure) => failure.forbidden) ? <p>{t('bulk.adjustPrice.forbiddenHint')}</p> : null}
    </div>
  )
}

type PriceDialogProps = { items: InventoryItem[]; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }

function BulkPriceDialog({ items, open, onOpenChange, onDone }: PriceDialogProps) {
  const { t } = useTranslation('inventory')
  const mutation = useBulkAdjustInventoryPrices()
  const [percent, setPercent] = useState('')
  const [result, setResult] = useState<BulkPriceResult | null>(null)
  const value = parsePercent(percent)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (value === null) return
    // After a partial result only the failed parts are sent again: the others already carry the new price.
    const failedIds = new Set(result?.failed.map((failure) => failure.id))
    const targets = result ? items.filter((item) => failedIds.has(item.id)) : items
    const outcome = await mutation.mutateAsync({ items: targets, percent: value })
    const updated = (result?.updated ?? 0) + outcome.updated
    if (outcome.failed.length === 0) {
      toast.success(t('bulk.adjustPrice.success', { count: updated }))
      onOpenChange(false)
      onDone()
      return
    }
    setResult({ total: items.length, updated, failed: outcome.failed })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('bulk.adjustPrice.title')}</DialogTitle>
            <DialogDescription>{t('bulk.adjustPrice.description', { count: items.length })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-price-percent">{t('bulk.adjustPrice.percentLabel')}</Label>
            <Input
              id="bulk-price-percent"
              inputMode="decimal"
              value={percent}
              disabled={result !== null}
              onChange={(event) => setPercent(event.target.value)}
              aria-describedby="bulk-price-percent-hint"
            />
            <p id="bulk-price-percent-hint" className="text-sm text-muted-foreground">{t('bulk.adjustPrice.percentHint')}</p>
          </div>
          {result ? <BulkPriceResultAlert result={result} /> : null}
          <DialogFooter>
            <Button type="submit" disabled={value === null || mutation.isPending}>
              {mutation.isPending ? t('bulk.adjustPrice.submitting') : result ? t('bulk.adjustPrice.retryFailed') : t('bulk.adjustPrice.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type InventoryBulkActionsProps = { items: InventoryItem[]; clearSelection: () => void }

/** Bulk actions of the parts list: the registry action as a bar button, the same entry in Cmd+K, and its dialog. */
export function InventoryBulkActions({ items, clearSelection }: InventoryBulkActionsProps) {
  const { t } = useTranslation('inventory')
  const role = useAuthRole()
  const [open, setOpen] = useState(false)
  // A new key per opening: a closed dialog never shows the percent or the failures of the last run.
  const [openings, setOpenings] = useState(0)
  const actions = useMemo(() => createInventoryBulkActions(t), [t])
  const runContext = useMemo(
    () => ({
      openPriceDialog: () => {
        setOpenings((count) => count + 1)
        setOpen(true)
      },
    }),
    [],
  )

  useEffect(() => {
    const entries = mapRegistryActionsToPalette(actions, role, items, runContext, () =>
      t('bulk.adjustPrice.paletteDescription', { count: items.length }),
    )
    publishSelectionPaletteSection(entries.length > 0 ? { heading: t('bulk.heading'), items: entries } : null)
    return () => publishSelectionPaletteSection(null)
  }, [actions, items, role, runContext, t])

  return (
    <>
      {items.length > MAX_BULK_INVENTORY_ITEMS ? (
        <span className="px-2 text-sm text-muted-foreground">{t('bulk.adjustPrice.limit', { max: MAX_BULK_INVENTORY_ITEMS })}</span>
      ) : (
        actions.map((action) => (
          <RegistryActionButton
            key={action.id}
            action={action}
            record={items}
            runContext={runContext}
            role={role}
            variant="outline"
            size="sm"
            className="min-h-11 md:min-h-8"
          />
        ))
      )}
      <BulkPriceDialog key={openings} items={items} open={open} onOpenChange={setOpen} onDone={clearSelection} />
    </>
  )
}
