import { useEffect, useState } from 'react'
import { useNovaCalculate } from '@/api/nova'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'

type NovaPreviewPanelProps = {
  vehicleId: string
  firstRegistrationDate: string | null
  co2Wltp: number | null
  co2Nedc: number | null
  typenscheinNo: string | null
  novaClass: string | null
  initialNetPriceEuro?: number | string | null
}

function display(value: string | number | null): string | number {
  return value ?? '—'
}

export function NovaPreviewPanel({
  vehicleId,
  firstRegistrationDate,
  co2Wltp,
  co2Nedc,
  typenscheinNo,
  novaClass,
  initialNetPriceEuro,
}: NovaPreviewPanelProps) {
  const [netPrice, setNetPrice] = useState(
    initialNetPriceEuro == null ? '' : String(initialNetPriceEuro),
  )
  const [hasCurrentCalculation, setHasCurrentCalculation] = useState(false)
  const { mutate, reset, data, error, isPending } = useNovaCalculate()

  useEffect(() => {
    setHasCurrentCalculation(false)
    reset()
    setNetPrice(initialNetPriceEuro == null ? '' : String(initialNetPriceEuro))
  }, [
    vehicleId,
    firstRegistrationDate,
    co2Wltp,
    co2Nedc,
    typenscheinNo,
    novaClass,
    initialNetPriceEuro,
    reset,
  ])
  const netPriceEuro = Number(netPrice)
  const canCalculate =
    netPrice.trim() !== '' && Number.isFinite(netPriceEuro) && netPriceEuro >= 0
  const calculationError = error as (Error & { code?: string }) | null

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="nova-preview-title">
      <div>
        <h3 id="nova-preview-title" className="text-sm font-semibold text-slate-700">
          NoVA-Vorschau
        </h3>
        <div className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
          <div>Erstzulassung: {display(firstRegistrationDate)}</div>
          <div>CO₂ WLTP (g/km): {display(co2Wltp)}</div>
          <div>CO₂ NEDC (g/km): {display(co2Nedc)}</div>
          <div>Typenschein-Nr.: {display(typenscheinNo)}</div>
          <div>NoVA-Klasse: {display(novaClass)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 space-y-1 text-sm">
          <span className="text-slate-600">NoVA-Netto-Preis</span>
          <Input
            aria-label="NoVA-Netto-Preis"
            type="number"
            min={0}
            step="0.01"
            value={netPrice}
            onChange={(event) => {
              setNetPrice(event.target.value)
              setHasCurrentCalculation(false)
              reset()
            }}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={!vehicleId || !canCalculate || isPending}
          onClick={() => {
            reset()
            setHasCurrentCalculation(true)
            mutate({ vehicleId, netPriceEuro })
          }}
        >
          {isPending ? 'Berechnung läuft…' : 'NoVA berechnen'}
        </Button>
      </div>

      {calculationError?.code === 'MISSING_CO2' ? (
        <p className="text-sm text-amber-700" role="status">
          CO2 fehlt
        </p>
      ) : null}
      {calculationError && calculationError.code !== 'MISSING_CO2' ? (
        <p className="text-sm text-rose-700" role="alert">
          {calculationError.message}
        </p>
      ) : null}

      {data && hasCurrentCalculation ? (
        <div className="space-y-2 border-t pt-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600">Berechnete NoVA</span>
            <strong>{formatCurrency(data.novaAmountEuro)}</strong>
          </div>
          <div className="text-xs text-slate-600">
            Tarifversion: <span>{data.tariffVersionId}</span>
          </div>
          <div className="text-xs text-slate-600">
            Angewandte Regeln: {data.appliedRuleIds.length ? data.appliedRuleIds.join(', ') : '—'}
          </div>
          {data.warnings.length ? (
            <div className="text-xs text-slate-600">Hinweise: {data.warnings.join(', ')}</div>
          ) : null}
          {data.hasUnverifiedRules ? (
            <p className="text-sm font-medium text-amber-800">
              Vorschau - Steuerberater-Bestätigung ausstehend
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
