import { useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type Ref } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useRemoveVehicleSaleTradeIn,
  useUpsertVehicleSaleTradeIn,
  type VehicleSaleTradeInInput,
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
const STORED_TRADE_IN_INCOMPLETE_MESSAGE =
  'Remove the trade-in or complete its details before finalizing.'

export type VehicleSaleTradeInHandle = {
  /**
   * Saves a trade-in that has changes still inside the autosave window. Rejects when the trade-in on the form
   * is incomplete or the save fails, so the sale is not invoiced without a trade-in the user has entered.
   */
  flush: () => Promise<void>
}

/** Runs tasks one after another. A failed task does not block the tasks queued after it. */
function runInOrder<T>(queue: { current: Promise<void> }, task: () => Promise<T>): Promise<T> {
  const run = queue.current.then(task)
  queue.current = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

type VehicleSaleTradeInSectionProps = {
  /** Empty until the sale has been saved once; the trade-in can only be entered after that. */
  saleId: string
  /** Current sale price, used to keep the allowance within the price. NaN when not entered. */
  salePrice: number
  purchase: VehicleSaleTradeInPurchase | null
  editable: boolean
  ref?: Ref<VehicleSaleTradeInHandle>
}

export function VehicleSaleTradeInSection({
  saleId,
  salePrice,
  purchase,
  editable,
  ref,
}: VehicleSaleTradeInSectionProps) {
  const { mutateAsync: upsertTradeIn } = useUpsertVehicleSaleTradeIn()
  const { mutateAsync: removeTradeIn } = useRemoveVehicleSaleTradeIn()
  const [draft, setDraft] = useState<TradeInDraft>(() => tradeInDraftFromPurchase(purchase))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Hydrate from the server once per trade-in, so autosave responses never overwrite typing.
  const hydratedPurchaseId = useRef<string | null | undefined>(undefined)
  const lastSavedSerialized = useRef<string | null>(null)
  const saveTimer = useRef<number | null>(null)
  // Saves and removals share this queue, so an autosave, a finalize flush and a removal never interleave.
  const saveQueue = useRef<Promise<void>>(Promise.resolve())

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

  const saveTradeIn = (snapshot: { saleId: string; input: VehicleSaleTradeInInput; serialized: string }) =>
    runInOrder(saveQueue, async () => {
      if (snapshot.serialized === lastSavedSerialized.current) return
      setSaveStatus('saving')
      try {
        const sale = await upsertTradeIn({ id: snapshot.saleId, data: snapshot.input })
        hydratedPurchaseId.current = sale.trade_in_purchase?.id ?? null
        lastSavedSerialized.current = snapshot.serialized
        setSaveStatus('saved')
      } catch (error) {
        setSaveStatus('error')
        throw error
      }
    })

  useEffect(() => {
    if (!canEdit || result.status !== 'valid') return
    const serialized = JSON.stringify(result.input)
    if (serialized === lastSavedSerialized.current) return
    const snapshot = { saleId, input: result.input, serialized }
    const handle = window.setTimeout(() => {
      saveTimer.current = null
      saveTradeIn(snapshot).catch((error) => toast.error(getErrorMessage(error, 'Failed to save trade-in')))
    }, AUTO_SAVE_DEBOUNCE_MS)
    saveTimer.current = handle
    return () => {
      window.clearTimeout(handle)
      if (saveTimer.current === handle) saveTimer.current = null
    }
    // `result` is derived from `draft` and `salePrice`; those are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, draft, salePrice, saleId, upsertTradeIn])

  // Re-created on every render, so the page always flushes the form it is showing.
  useImperativeHandle(ref, () => ({
    flush: async () => {
      // Not gated on `editable`: the page turns editing off before it flushes, to stop further edits.
      if (saleId === '') return
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      if (result.status === 'invalid') throw new Error(result.message)
      if (result.status === 'empty') {
        // A blank form with a stored trade-in would still be netted on the invoice, so stop instead.
        if (purchase) throw new Error(STORED_TRADE_IN_INCOMPLETE_MESSAGE)
        return
      }
      await saveTradeIn({ saleId, input: result.input, serialized: JSON.stringify(result.input) })
    },
  }))

  const handleRemoveTradeIn = async () => {
    if (!saleId || !purchase) return
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    try {
      await runInOrder(saveQueue, () => removeTradeIn(saleId))
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
        <div role="status" aria-live="polite" className="text-sm">
          {saveStatus === 'saving' && <span className="text-slate-500">Saving...</span>}
          {saveStatus === 'saved' && <span className="text-emerald-600">Saved</span>}
          {saveStatus === 'error' && <span className="text-rose-600">Save failed</span>}
        </div>
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
          <Input maxLength={17} disabled={!canEdit} value={draft.vin} onChange={handleFieldChange('vin')} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Make</span>
          <Input disabled={!canEdit} value={draft.make} onChange={handleFieldChange('make')} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Model</span>
          <Input disabled={!canEdit} value={draft.model} onChange={handleFieldChange('model')} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Model year</span>
          <Input type="number" disabled={!canEdit} value={draft.year} onChange={handleFieldChange('year')} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Mileage (km)</span>
          <Input
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
            type="date"
            disabled={!canEdit}
            value={draft.firstRegistrationDate}
            onChange={handleFieldChange('firstRegistrationDate')}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Plate (optional)</span>
          <Input disabled={!canEdit} value={draft.plate} onChange={handleFieldChange('plate')} />
        </label>
      </div>
      <p aria-live="polite" className="text-xs text-rose-600">
        {validationMessage}
      </p>
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
