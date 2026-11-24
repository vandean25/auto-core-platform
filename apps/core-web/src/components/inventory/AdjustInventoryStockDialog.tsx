import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  useAdjustInventoryStock,
  useAdjustmentValuation,
  type AdjustmentValuation,
  type StockAdjustmentReason,
} from '@/api/inventory'
import { useLocations } from '@/api/locations'
import { SubmitButtonPending } from '@/components/data-table/data-table-states'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getErrorMessage } from '@/lib/error-utils'
import { formatCurrency, formatNumber } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import {
  formatStockAdjustmentReason,
  formatStockAdjustmentValueSource,
} from '@/lib/i18n/enum-labels'

const ADJUSTMENT_REASONS: readonly StockAdjustmentReason[] = [
  'INVENTORY_COUNT',
  'BREAKAGE',
  'SHRINKAGE',
  'FOUND',
  'BOOKING_ERROR',
  'OTHER',
]

type ValuationSectionProps = {
  valuation: AdjustmentValuation
  extendedPreview: number | null
  needsManualValue: boolean
  overrideEnabled: boolean
  onOverrideChange: (next: boolean) => void
  isManualMode: boolean
  manualUnitCost: string
  onManualUnitCostChange: (next: string) => void
  overrideReason: string
  onOverrideReasonChange: (next: string) => void
}

function AdjustmentValuationSection({
  valuation,
  extendedPreview,
  needsManualValue,
  overrideEnabled,
  onOverrideChange,
  isManualMode,
  manualUnitCost,
  onManualUnitCostChange,
  overrideReason,
  onOverrideReasonChange,
}: ValuationSectionProps) {
  const { t } = useTranslation('inventory')

  return (
    <>
      <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
        {valuation.unitCost !== null ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">
              {t('dialogs.adjustStock.automaticValue')} (
              {formatStockAdjustmentValueSource(valuation.valueSource)})
            </span>
            <span className="font-medium tabular-nums">
              {formatNumber(valuation.unitCost, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}{' '}
              €
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('dialogs.adjustStock.noAutomaticValue')}
          </p>
        )}

        {extendedPreview !== null ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">
              {t('dialogs.adjustStock.extendedValuePreview')}
            </span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(extendedPreview)}
            </span>
          </div>
        ) : null}

        {needsManualValue && !valuation.canOverrideValue ? (
          <p className="text-xs text-destructive">
            {t('dialogs.adjustStock.overridePermissionRequired')}
          </p>
        ) : null}

        {valuation.canOverrideValue && valuation.unitCost !== null ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 pt-1 text-sm">
            <input
              type="checkbox"
              checked={overrideEnabled}
              onChange={(e) => onOverrideChange(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span>{t('dialogs.adjustStock.overrideToggle')}</span>
          </label>
        ) : null}
      </div>

      {isManualMode ? (
        <div className="grid gap-3 rounded-md border border-border p-3">
          <div className="grid gap-2">
            <Label htmlFor="adjust-unit-cost">{t('dialogs.adjustStock.manualUnitCost')}</Label>
            <Input
              id="adjust-unit-cost"
              name="unitCost"
              type="number"
              step="0.0001"
              min="0"
              value={manualUnitCost}
              onChange={(e) => onManualUnitCostChange(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="adjust-override-reason">
              {t('dialogs.adjustStock.overrideReason')}
            </Label>
            <Input
              id="adjust-override-reason"
              name="overrideReason"
              value={overrideReason}
              onChange={(e) => onOverrideReasonChange(e.target.value)}
              required
            />
          </div>
        </div>
      ) : null}
    </>
  )
}

type AdjustmentPreviewState = {
  needsManualValue: boolean
  isManualMode: boolean
  parsedQuantity: number
  extendedPreview: number | null
}

type AdjustmentValidationErrorKey =
  | 'dialogs.adjustStock.validationRequired'
  | 'dialogs.adjustStock.validationNoteRequired'
  | 'dialogs.adjustStock.validationManualValueRequired'
  | 'dialogs.adjustStock.overridePermissionRequired'

function resolveEffectiveUnitCost(
  valuation: AdjustmentValuation | undefined,
  isManualMode: boolean,
  manualUnitCost: string,
): number {
  if (isManualMode) return Number(manualUnitCost)
  if (valuation?.unitCost !== null && valuation?.unitCost !== undefined) {
    return Number(valuation.unitCost)
  }
  return Number.NaN
}

function computeAdjustmentPreview(params: {
  valuation: AdjustmentValuation | undefined
  quantityText: string
  overrideEnabled: boolean
  manualUnitCost: string
}): AdjustmentPreviewState {
  const { valuation, quantityText, overrideEnabled, manualUnitCost } = params
  const needsManualValue = valuation !== undefined && valuation.unitCost === null
  const isManualMode = Boolean(valuation?.canOverrideValue) && (needsManualValue || overrideEnabled)
  const effectiveUnitCost = resolveEffectiveUnitCost(valuation, isManualMode, manualUnitCost)
  const parsedQuantity = Number(quantityText)
  const validPreview = !Number.isNaN(parsedQuantity) && parsedQuantity !== 0 && !Number.isNaN(effectiveUnitCost)
  const extendedPreview = validPreview ? Math.round(parsedQuantity * effectiveUnitCost * 100) / 100 : null
  return { needsManualValue, isManualMode, parsedQuantity, extendedPreview }
}

type AdjustmentPayloadResult =
  | {
      ok: true
      payload: {
        locationId: string
        quantity: number
        reason: StockAdjustmentReason
        note?: string
        unitCost?: number
        overrideReason?: string
      }
    }
  | { ok: false; errorKey: AdjustmentValidationErrorKey }

function validateAdjustmentCost(params: {
  isManualMode: boolean
  manualUnitCost: string
  overrideReason: string
  needsManualValue: boolean
  canOverrideValue: boolean
}): AdjustmentValidationErrorKey | null {
  if (params.isManualMode) {
    const parsedCost = Number(params.manualUnitCost)
    const missingCost = params.manualUnitCost.trim() === '' || Number.isNaN(parsedCost) || parsedCost < 0
    if (missingCost || !params.overrideReason.trim()) {
      return 'dialogs.adjustStock.validationManualValueRequired'
    }
    return null
  }
  if (params.needsManualValue && !params.canOverrideValue) {
    return 'dialogs.adjustStock.overridePermissionRequired'
  }
  return null
}

function buildAdjustmentPayload(params: {
  locationId: string
  parsedQuantity: number
  reason: StockAdjustmentReason | ''
  note: string
  isManualMode: boolean
  manualUnitCost: string
  overrideReason: string
  needsManualValue: boolean
  canOverrideValue: boolean
}): AdjustmentPayloadResult {
  const { locationId, parsedQuantity, reason, note, isManualMode, manualUnitCost, overrideReason } = params

  if (!locationId || Number.isNaN(parsedQuantity) || parsedQuantity === 0 || !reason) {
    return { ok: false, errorKey: 'dialogs.adjustStock.validationRequired' }
  }
  const trimmedNote = note.trim()
  if (reason === 'OTHER' && !trimmedNote) {
    return { ok: false, errorKey: 'dialogs.adjustStock.validationNoteRequired' }
  }
  const costError = validateAdjustmentCost(params)
  if (costError) {
    return { ok: false, errorKey: costError }
  }

  return {
    ok: true,
    payload: {
      locationId,
      quantity: parsedQuantity,
      reason,
      ...(trimmedNote ? { note: trimmedNote } : {}),
      ...(isManualMode ? { unitCost: Number(manualUnitCost), overrideReason: overrideReason.trim() } : {}),
    },
  }
}

type AdjustInventoryStockDialogProps = {
  itemId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AdjustInventoryStockDialog({
  itemId,
  open,
  onOpenChange,
}: AdjustInventoryStockDialogProps) {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const adjustMutation = useAdjustInventoryStock(itemId)
  const { data: locations } = useLocations({ enabled: open })
  const binLocations = React.useMemo(
    () => (locations ?? []).filter((location) => location.type === 'bin'),
    [locations],
  )

  const [locationId, setLocationId] = React.useState('')
  const [quantityText, setQuantityText] = React.useState('')
  const [reason, setReason] = React.useState<StockAdjustmentReason | ''>('')
  const [note, setNote] = React.useState('')
  const [overrideEnabled, setOverrideEnabled] = React.useState(false)
  const [manualUnitCost, setManualUnitCost] = React.useState('')
  const [overrideReason, setOverrideReason] = React.useState('')

  const { data: valuation } = useAdjustmentValuation(itemId, locationId, open)

  React.useEffect(() => {
    if (!open) {
      setLocationId('')
      setQuantityText('')
      setReason('')
      setNote('')
      setOverrideEnabled(false)
      setManualUnitCost('')
      setOverrideReason('')
    }
  }, [open])

  const { needsManualValue, isManualMode, parsedQuantity, extendedPreview } = computeAdjustmentPreview({
    valuation,
    quantityText,
    overrideEnabled,
    manualUnitCost,
  })

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = buildAdjustmentPayload({
      locationId,
      parsedQuantity,
      reason,
      note,
      isManualMode,
      manualUnitCost,
      overrideReason,
      needsManualValue,
      canOverrideValue: Boolean(valuation?.canOverrideValue),
    })
    if (!result.ok) {
      toast.error(t(result.errorKey))
      return
    }

    try {
      await adjustMutation.mutateAsync(result.payload)
      toast.success(t('dialogs.adjustStock.success'))
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('dialogs.adjustStock.failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('dialogs.adjustStock.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t('dialogs.adjustStock.storageBin')}</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="max-sm:min-h-11">
                  <SelectValue placeholder={t('dialogs.adjustStock.selectBin')} />
                </SelectTrigger>
                <SelectContent>
                  {binLocations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="adjust-quantity">{t('dialogs.adjustStock.signedQuantity')}</Label>
              <Input
                id="adjust-quantity"
                name="quantity"
                type="number"
                step="0.001"
                value={quantityText}
                onChange={(e) => setQuantityText(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t('dialogs.adjustStock.signedQuantityHint')}
              </p>
            </div>

            <div className="grid gap-2">
              <Label>{t('dialogs.adjustStock.reason')}</Label>
              <Select value={reason} onValueChange={(value) => setReason(value as StockAdjustmentReason)}>
                <SelectTrigger className="max-sm:min-h-11">
                  <SelectValue placeholder={t('dialogs.adjustStock.selectReason')} />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_REASONS.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {formatStockAdjustmentReason(entry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="adjust-note">{t('dialogs.adjustStock.note')}</Label>
              <Input
                id="adjust-note"
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required={reason === 'OTHER'}
              />
              {reason === 'OTHER' ? (
                <p className="text-xs text-muted-foreground">
                  {t('dialogs.adjustStock.noteRequiredHint')}
                </p>
              ) : null}
            </div>

            {valuation ? (
              <AdjustmentValuationSection
                valuation={valuation}
                extendedPreview={extendedPreview}
                needsManualValue={needsManualValue}
                overrideEnabled={overrideEnabled}
                onOverrideChange={setOverrideEnabled}
                isManualMode={isManualMode}
                manualUnitCost={manualUnitCost}
                onManualUnitCostChange={setManualUnitCost}
                overrideReason={overrideReason}
                onOverrideReasonChange={setOverrideReason}
              />
            ) : null}
          </div>
          <DialogFooter>
            <SubmitButtonPending
              type="submit"
              pending={adjustMutation.isPending}
              label={t('actions.applyAdjustment')}
              className="max-sm:min-h-11"
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
