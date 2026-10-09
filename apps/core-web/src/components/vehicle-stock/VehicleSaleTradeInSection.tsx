import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useRemoveVehicleSaleTradeIn,
  useUpsertVehicleSaleTradeIn,
  type VehicleSaleTradeInPurchase,
} from '@/api/vehicle-stock'
import { formatCurrency } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-utils'
import {
  EMPTY_TRADE_IN_DRAFT,
  buildTradeInInput,
  tradeInDraftFromPurchase,
  type TradeInDraft,
} from '@/lib/vehicle-sale-trade-in'

const AUTO_SAVE_DEBOUNCE_MS = 750

type VehicleSaleTradeInSectionProps = {
  /** Empty until the sale has been saved once; the trade-in can only be entered after that. */
  saleId: string
  /** Current sale price, used to keep the allowance within the price. NaN when not entered. */
  salePrice: number
  purchase: VehicleSaleTradeInPurchase | null
  editable: boolean
}

export function VehicleSaleTradeInSection({
  saleId,
  salePrice,
  purchase,
  editable,
}: VehicleSaleTradeInSectionProps) {
  const { mutateAsync: upsertTradeIn } = useUpsertVehicleSaleTradeIn()
  const { mutateAsync: removeTradeIn } = useRemoveVehicleSaleTradeIn()
  const [draft, setDraft] = useState<TradeInDraft>(() => tradeInDraftFromPurchase(purchase))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Hydrate from the server once per trade-in, so autosave responses never overwrite typing.
  const hydratedPurchaseId = useRef<string | null | undefined>(undefined)
  const lastSavedSerialized = useRef<string | null>(null)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    const purchaseId = purchase?.id ?? null
    if (hydratedPurchaseId.current === purchaseId) return
    hydratedPurchaseId.current = purchaseId
    const hydrated = tradeInDraftFromPurchase(purchase)
    setDraft(hydrated)
    // A stored trade-in is already saved: seeding the last-saved value stops autosave from rewriting it on open.
    const stored = buildTradeInInput(hydrated, salePrice)
    lastSavedSerialized.current = stored.status === 'valid' ? JSON.stringify(stored.input) : null
  }, [purchase, salePrice])

  const result = buildTradeInInput(draft, salePrice)
  const canEdit = editable && saleId !== ''

  useEffect(() => {
    if (!canEdit || result.status !== 'valid') return
    const serialized = JSON.stringify(result.input)
    if (serialized === lastSavedSerialized.current) return
    const handle = window.setTimeout(() => {
      saveTimer.current = null
      setSaveStatus('saving')
      upsertTradeIn({ id: saleId, data: result.input })
        .then((sale) => {
          hydratedPurchaseId.current = sale.trade_in_purchase?.id ?? null
          lastSavedSerialized.current = serialized
          setSaveStatus('saved')
        })
        .catch((error) => {
          setSaveStatus('error')
          toast.error(getErrorMessage(error, 'Failed to save trade-in'))
        })
    }, AUTO_SAVE_DEBOUNCE_MS)
    saveTimer.current = handle
    return () => {
      window.clearTimeout(handle)
      if (saveTimer.current === handle) saveTimer.current = null
    }
    // `result` is derived from `draft` and `salePrice`; those are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, draft, salePrice, saleId, upsertTradeIn])

  const handleRemoveTradeIn = async () => {
    if (!saleId || !purchase) return
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    try {
      await removeTradeIn(saleId)
      hydratedPurchaseId.current = null
      lastSavedSerialized.current = null
      setDraft(EMPTY_TRADE_IN_DRAFT)
      setSaveStatus('idle')
      toast.success('Trade-in removed')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove trade-in'))
    }
  }

  const handleFieldChange = (field: keyof TradeInDraft) => (event: ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }))

  const validationMessage = result.status === 'invalid' ? result.message : null
  const canRemoveTradeIn = purchase !== null && editable
  const amountDue =
    result.status === 'valid' && Number.isFinite(salePrice) && salePrice > 0
      ? formatCurrency(salePrice - result.input.allowance)
      : null

  return (
    <section aria-labelledby="trade-in-form-title" className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 id="trade-in-form-title" className="font-medium">Trade-in</h2>
        {saveStatus === 'saving' && <span className="text-sm text-slate-500">Saving...</span>}
        {saveStatus === 'saved' && <span className="text-sm text-emerald-600">Saved</span>}
        {saveStatus === 'error' && <span className="text-sm text-rose-600">Save failed</span>}
      </div>
      <p className="text-xs text-slate-500">
        {saleId
          ? 'The buyer’s vehicle is credited against the sale price. The invoice bills the remaining amount.'
          : 'Save the sale first, then add the buyer’s vehicle as a trade-in.'}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Allowance (EUR)</span>
          <Input
            aria-label="Trade-in allowance"
            type="number"
            min={0}
            step="0.01"
            disabled={!canEdit}
            value={draft.allowance}
            onChange={handleFieldChange('allowance')}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">VIN</span>
          <Input
            aria-label="Trade-in VIN"
            maxLength={17}
            disabled={!canEdit}
            value={draft.vin}
            onChange={handleFieldChange('vin')}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Make</span>
          <Input aria-label="Trade-in make" disabled={!canEdit} value={draft.make} onChange={handleFieldChange('make')} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Model</span>
          <Input aria-label="Trade-in model" disabled={!canEdit} value={draft.model} onChange={handleFieldChange('model')} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Model year</span>
          <Input
            aria-label="Trade-in model year"
            type="number"
            disabled={!canEdit}
            value={draft.year}
            onChange={handleFieldChange('year')}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Mileage (km)</span>
          <Input
            aria-label="Trade-in mileage"
            type="number"
            min={0}
            disabled={!canEdit}
            value={draft.mileage}
            onChange={handleFieldChange('mileage')}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">First registration</span>
          <Input
            aria-label="Trade-in first registration"
            type="date"
            disabled={!canEdit}
            value={draft.firstRegistrationDate}
            onChange={handleFieldChange('firstRegistrationDate')}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Plate (optional)</span>
          <Input aria-label="Trade-in plate" disabled={!canEdit} value={draft.plate} onChange={handleFieldChange('plate')} />
        </label>
      </div>
      {validationMessage ? <p className="text-xs text-rose-600">{validationMessage}</p> : null}
      {amountDue ? (
        <p className="text-sm">
          Amount due after trade-in: <span className="font-medium">{amountDue}</span>
        </p>
      ) : null}
      {canRemoveTradeIn ? (
        <Button variant="outline" size="sm" onClick={() => void handleRemoveTradeIn()}>
          Remove trade-in
        </Button>
      ) : null}
    </section>
  )
}
