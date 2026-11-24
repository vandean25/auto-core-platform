import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  fenceResultToStatus,
  freezePriceIntents,
  isDefiniteFailureStatus,
  removeFrozenIntents,
  useExecuteGuardedPriceChanges,
  useFenceInventoryPriceOperation,
  usePreviewGuardedPriceChanges,
  type FrozenGuardedPriceIntent,
  type GuardedPriceItemOutcome,
  type PreviewPriceResult,
  type PreviewReadFailure,
} from '@/api/inventory-price-operations'
import type { InventoryItem } from '@/api/types'
import { mapRegistryActionsToPalette } from '@/components/global-search/global-search-context-actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import { MAX_BULK_INVENTORY_ITEMS, createInventoryBulkActions } from '@/features/actions/inventory-bulk-actions'
import { publishSelectionPaletteSection } from '@/features/actions/selection-palette-store'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { formatCurrency } from '@/lib/format'
import { GuardedPriceStateBadge } from './GuardedPriceStateBadge'

const MIN_PERCENT = -50
const MAX_PERCENT = 100
const SKUS_SHOWN = 3

function parsePercent(raw: string): number | null {
  const value = Number(raw.replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(value) && value !== 0 && value >= MIN_PERCENT && value <= MAX_PERCENT ? value : null
}

function formatGroupedSkus(
  skus: string[],
  t: ReturnType<typeof useTranslation<'inventory'>>['t'],
): string {
  const shown = skus.slice(0, SKUS_SHOWN).join(', ')
  return skus.length > SKUS_SHOWN
    ? t('bulk.adjustPrice.skusMore', { skus: shown, rest: skus.length - SKUS_SHOWN })
    : shown
}

function DefiniteFailureGroups({
  items,
}: {
  items: Array<{ sku: string; status: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID' }>
}) {
  const { t } = useTranslation('inventory')
  const groups = [
    { reason: t('bulk.adjustPrice.reasonForbidden'), entries: items.filter((item) => item.status === 'FORBIDDEN') },
    { reason: t('bulk.adjustPrice.reasonFailed'), entries: items.filter((item) => item.status !== 'FORBIDDEN') },
  ].filter((group) => group.entries.length > 0)

  if (groups.length === 0) return null

  return (
    <div className="space-y-1 text-sm text-destructive">
      <ul className="list-disc pl-5">
        {groups.map(({ reason, entries }) => (
          <li key={reason}>
            {t('bulk.adjustPrice.failedGroup', {
              count: entries.length,
              reason,
              skus: formatGroupedSkus(entries.map((entry) => entry.sku), t),
            })}
          </li>
        ))}
      </ul>
      {items.some((item) => item.status === 'FORBIDDEN') ? <p>{t('bulk.adjustPrice.forbiddenHint')}</p> : null}
    </div>
  )
}

type PreviewStepProps = {
  preview: PreviewPriceResult
  isSubmitting: boolean
  onBack: () => void
  onConfirm: () => void
}

function BulkPreviewStep({ preview, isSubmitting, onBack, onConfirm }: PreviewStepProps) {
  const { t } = useTranslation('inventory')
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t('bulk.adjustPrice.previewHeading')}</p>
        <p className="text-sm text-muted-foreground">
          {t('bulk.adjustPrice.previewSummary', { count: preview.ready.length })}
        </p>
      </div>

      {preview.ready.length > 0 ? (
        <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {preview.ready.map((item) => (
            <li
              key={item.itemId}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
            >
              <span className="truncate font-medium text-foreground">{item.sku}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {t('bulk.adjustPrice.discovery.priceTransition', {
                  basis: formatCurrency(item.basisPrice),
                  target: formatCurrency(item.targetPrice),
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {preview.failed.length > 0 ? (
        <div role="alert">
          <DefiniteFailureGroups items={preview.failed} />
        </div>
      ) : null}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={isSubmitting} onClick={onBack}>
          {t('bulk.adjustPrice.back')}
        </Button>
        <Button
          type="button"
          className="min-h-11 md:min-h-9"
          disabled={preview.ready.length === 0 || isSubmitting}
          onClick={onConfirm}
        >
          {isSubmitting ? t('bulk.adjustPrice.submitting') : t('bulk.adjustPrice.confirm')}
        </Button>
      </DialogFooter>
    </div>
  )
}

type ResultStepProps = {
  outcomes: GuardedPriceItemOutcome[]
  previewFailures: PreviewReadFailure[]
  isRetrying: boolean
  fencingKey: string | null
  onRetryDefinite: () => void
  onNewPreviewConflict: (outcome: GuardedPriceItemOutcome) => void
  onFence: (outcome: GuardedPriceItemOutcome) => void
  onClose: () => void
}

function BulkResultStep({
  outcomes,
  previewFailures,
  isRetrying,
  fencingKey,
  onRetryDefinite,
  onNewPreviewConflict,
  onFence,
  onClose,
}: ResultStepProps) {
  const { t } = useTranslation('inventory')
  const appliedCount = outcomes.filter((item) => item.status === 'APPLIED').length
  const totalCount = outcomes.length + previewFailures.length
  const patchDefiniteFailures = outcomes.filter(
    (item): item is GuardedPriceItemOutcome & { status: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID' } =>
      isDefiniteFailureStatus(item.status) && item.retryable !== false,
  )
  const fenceDefiniteFailures = outcomes.filter(
    (item): item is GuardedPriceItemOutcome & { status: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID' } =>
      isDefiniteFailureStatus(item.status) && item.retryable === false,
  )
  const definiteFailures = [...patchDefiniteFailures, ...fenceDefiniteFailures, ...previewFailures]
  const stateEntries = outcomes.filter(
    (item) => item.status !== 'APPLIED' && !isDefiniteFailureStatus(item.status),
  )

  return (
    <div className="space-y-4">
      <div role="alert" className="space-y-3">
        <p className="text-sm font-medium text-foreground">
          {t('bulk.adjustPrice.result', { updated: appliedCount, total: totalCount })}
        </p>

        <DefiniteFailureGroups items={definiteFailures} />

        {stateEntries.length > 0 ? (
          <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {stateEntries.map((entry) => (
              <li
                key={entry.key}
                className="flex flex-col gap-2 rounded-md border border-border bg-muted/50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{entry.sku}</span>
                    <GuardedPriceStateBadge status={entry.status} />
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t('bulk.adjustPrice.discovery.priceTransition', {
                      basis: formatCurrency(entry.basisPrice),
                      target: formatCurrency(entry.targetPrice),
                    })}
                  </p>
                </div>
                {entry.status === 'CONFLICT' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 md:min-h-8"
                    onClick={() => onNewPreviewConflict(entry)}
                  >
                    {t('bulk.adjustPrice.newPreview')}
                  </Button>
                ) : null}
                {entry.status === 'UNRESOLVED' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 md:min-h-8"
                    disabled={fencingKey === entry.key}
                    onClick={() => onFence(entry)}
                  >
                    {fencingKey === entry.key ? t('bulk.adjustPrice.markingNotApplied') : t('bulk.adjustPrice.markNotApplied')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={onClose}>
          {t('bulk.adjustPrice.close')}
        </Button>
        {patchDefiniteFailures.length > 0 ? (
          <Button type="button" className="min-h-11 md:min-h-9" disabled={isRetrying} onClick={onRetryDefinite}>
            {isRetrying ? t('bulk.adjustPrice.submitting') : t('bulk.adjustPrice.retryFailed')}
          </Button>
        ) : null}
      </DialogFooter>
    </div>
  )
}

type PercentStepProps = {
  percent: string
  isValid: boolean
  isLoading: boolean
  onPercentChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}

function BulkPercentStep({ percent, isValid, isLoading, onPercentChange, onSubmit }: PercentStepProps) {
  const { t } = useTranslation('inventory')
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="bulk-price-percent">{t('bulk.adjustPrice.percentLabel')}</Label>
        <Input
          id="bulk-price-percent"
          inputMode="decimal"
          className="min-h-11 md:min-h-9"
          value={percent}
          onChange={(event) => onPercentChange(event.target.value)}
          aria-describedby="bulk-price-percent-hint"
        />
        <p id="bulk-price-percent-hint" className="text-sm text-muted-foreground">
          {t('bulk.adjustPrice.percentHint')}
        </p>
      </div>
      <DialogFooter>
        <Button type="submit" className="min-h-11 md:min-h-9" disabled={!isValid || isLoading}>
          {isLoading ? t('bulk.adjustPrice.previewLoading') : t('bulk.adjustPrice.preview')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function mergeFrozenIntents(
  existing: FrozenGuardedPriceIntent[],
  incoming: FrozenGuardedPriceIntent[],
): FrozenGuardedPriceIntent[] {
  if (existing.length === 0) return incoming
  const byItemId = new Map(incoming.map((intent) => [intent.itemId, intent]))
  return [...existing.filter((intent) => !byItemId.has(intent.itemId)), ...incoming]
}

function mergeOutcomesByItem(
  existing: GuardedPriceItemOutcome[],
  incoming: GuardedPriceItemOutcome[],
): GuardedPriceItemOutcome[] {
  if (existing.length === 0) return incoming
  const byItemId = new Map(incoming.map((entry) => [entry.itemId, entry]))
  return existing.map((entry) => byItemId.get(entry.itemId) ?? entry)
}

type DialogBodyProps = {
  step: 'percent' | 'preview' | 'result'
  percent: string
  value: number | null
  preview: PreviewPriceResult | null
  previewFailures: PreviewReadFailure[]
  outcomes: GuardedPriceItemOutcome[]
  fencingKey: string | null
  isPreviewPending: boolean
  isExecutePending: boolean
  onPercentChange: (value: string) => void
  onSubmitPercent: (event: FormEvent) => void
  onBack: () => void
  onConfirm: () => void
  onRetryDefinite: () => void
  onNewPreviewConflict: (entry: GuardedPriceItemOutcome) => void
  onFence: (entry: GuardedPriceItemOutcome) => void
  onClose: () => void
}

function BulkPriceDialogBody(props: DialogBodyProps) {
  if (props.step === 'percent') {
    return (
      <BulkPercentStep
        percent={props.percent}
        isValid={props.value !== null}
        isLoading={props.isPreviewPending}
        onPercentChange={props.onPercentChange}
        onSubmit={props.onSubmitPercent}
      />
    )
  }
  if (props.step === 'preview' && props.preview) {
    return (
      <BulkPreviewStep
        preview={props.preview}
        isSubmitting={props.isExecutePending}
        onBack={props.onBack}
        onConfirm={props.onConfirm}
      />
    )
  }
  return (
    <BulkResultStep
      outcomes={props.outcomes}
      previewFailures={props.previewFailures}
      isRetrying={props.isExecutePending}
      fencingKey={props.fencingKey}
      onRetryDefinite={props.onRetryDefinite}
      onNewPreviewConflict={props.onNewPreviewConflict}
      onFence={props.onFence}
      onClose={props.onClose}
    />
  )
}

type PriceDialogProps = {
  items: Pick<InventoryItem, 'id' | 'sku' | 'name'>[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  /** Some parts did not apply: the selection narrows to them so succeeded parts are not changed again. */
  onPartial: (remainingIds: string[]) => void
}

export function BulkPriceDialog({ items, open, onOpenChange, onDone, onPartial }: PriceDialogProps) {
  const { t } = useTranslation('inventory')
  const previewMutation = usePreviewGuardedPriceChanges()
  const executeMutation = useExecuteGuardedPriceChanges()
  const fenceMutation = useFenceInventoryPriceOperation()

  const [percent, setPercent] = useState('')
  const [step, setStep] = useState<'percent' | 'preview' | 'result'>('percent')
  const [preview, setPreview] = useState<PreviewPriceResult | null>(null)
  const [previewFailures, setPreviewFailures] = useState<PreviewReadFailure[]>([])
  const [frozenIntents, setFrozenIntents] = useState<FrozenGuardedPriceIntent[]>([])
  const [outcomes, setOutcomes] = useState<GuardedPriceItemOutcome[]>([])
  const [fencingKey, setFencingKey] = useState<string | null>(null)
  const value = parsePercent(percent)

  const runPreview = async (
    targetItems: Pick<InventoryItem, 'id' | 'sku' | 'name'>[],
    targetPercent: number,
    resetBatch: boolean,
  ) => {
    const nextPreview = await previewMutation.mutateAsync({ items: targetItems, percent: targetPercent })
    setPreview(nextPreview)
    if (resetBatch) {
      setPreviewFailures(nextPreview.failed)
      setFrozenIntents([])
      setOutcomes([])
    }
    setStep('preview')
  }

  const finalizeIfAllApplied = (nextOutcomes: GuardedPriceItemOutcome[], failedReads: PreviewReadFailure[]) => {
    const allApplied = failedReads.length === 0 && nextOutcomes.every((entry) => entry.status === 'APPLIED')
    if (!allApplied) {
      const remainingIds = Array.from(
        new Set([
          ...nextOutcomes.filter((entry) => entry.status !== 'APPLIED').map((entry) => entry.itemId),
          ...failedReads.map((entry) => entry.itemId),
        ]),
      )
      onPartial(remainingIds)
      return false
    }
    removeFrozenIntents(nextOutcomes.map((entry) => entry.key))
    toast.success(t('bulk.adjustPrice.success', { count: nextOutcomes.length }))
    onOpenChange(false)
    onDone()
    return true
  }

  const confirmAndExecute = async () => {
    if (!preview || preview.ready.length === 0) return
    const frozen = freezePriceIntents(preview.ready)
    setFrozenIntents((prev) => mergeFrozenIntents(prev, frozen))
    const batchOutcomes = await executeMutation.mutateAsync(frozen)
    const nextOutcomes = mergeOutcomesByItem(outcomes, batchOutcomes)
    if (finalizeIfAllApplied(nextOutcomes, previewFailures)) return
    setOutcomes(nextOutcomes)
    setStep('result')
  }

  const retryDefiniteFailures = async () => {
    const retryKeys = new Set(
      outcomes
        .filter((entry) => isDefiniteFailureStatus(entry.status) && entry.retryable !== false)
        .map((entry) => entry.key),
    )
    const intentsToRetry = frozenIntents.filter((intent) => retryKeys.has(intent.key))
    if (intentsToRetry.length === 0) return
    const retriedByKey = new Map((await executeMutation.mutateAsync(intentsToRetry)).map((entry) => [entry.key, entry]))
    const merged = outcomes.map((entry) => retriedByKey.get(entry.key) ?? entry)
    if (finalizeIfAllApplied(merged, previewFailures)) return
    setOutcomes(merged)
  }

  const handleFence = async (outcome: GuardedPriceItemOutcome) => {
    setFencingKey(outcome.key)
    try {
      const result = await fenceMutation.mutateAsync({
        key: outcome.key,
        itemId: outcome.itemId,
        retail_price: outcome.targetPrice,
        expectedRevision: outcome.expectedRevision,
      })
      const nextStatus = fenceResultToStatus(result)
      const retryable = result.outcome === 'DEFINITE_FAILURE' ? false : outcome.retryable
      setOutcomes((prev) =>
        prev.map((entry) => (entry.key === outcome.key ? { ...entry, status: nextStatus, retryable } : entry)),
      )
    } catch {
      toast.error(t('bulk.adjustPrice.states.outcomeUnavailable'))
    } finally {
      setFencingKey(null)
    }
  }

  // A running request must not write its result into a dialog nobody can see.
  const isBusy = previewMutation.isPending || executeMutation.isPending || fenceMutation.isPending
  const handleOpenChange = (next: boolean) => {
    if (!next && isBusy) return
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('bulk.adjustPrice.title')}</DialogTitle>
          <DialogDescription>{t('bulk.adjustPrice.description', { count: items.length })}</DialogDescription>
        </DialogHeader>
        <BulkPriceDialogBody
          step={step}
          percent={percent}
          value={value}
          preview={preview}
          previewFailures={previewFailures}
          outcomes={outcomes}
          fencingKey={fencingKey}
          isPreviewPending={previewMutation.isPending}
          isExecutePending={executeMutation.isPending}
          onPercentChange={setPercent}
          onSubmitPercent={(event) => {
            event.preventDefault()
            if (value !== null) void runPreview(items, value, true)
          }}
          onBack={() => setStep('percent')}
          onConfirm={confirmAndExecute}
          onRetryDefinite={retryDefiniteFailures}
          onNewPreviewConflict={(entry) => {
            if (value !== null) void runPreview([{ id: entry.itemId, sku: entry.sku, name: entry.name }], value, false)
            else setStep('percent')
          }}
          onFence={handleFence}
          onClose={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

type InventoryBulkActionsProps = { items: InventoryItem[]; clearSelection: () => void; selectOnly: (ids: string[]) => void }

/** Bulk actions of the parts list: the registry action as a bar button, the same entry in Cmd+K, and its dialog. */
export function InventoryBulkActions({ items, clearSelection, selectOnly }: InventoryBulkActionsProps) {
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
      <BulkPriceDialog key={openings} items={items} open={open} onOpenChange={setOpen} onDone={clearSelection} onPartial={selectOnly} />
    </>
  )
}
