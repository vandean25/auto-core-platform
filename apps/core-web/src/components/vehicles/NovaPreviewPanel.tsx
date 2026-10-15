import { useEffect, useState } from 'react'
import { useNovaCalculate } from '@/api/nova'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import { formatNovaPreviewWarning } from './nova-preview-warnings'

type NovaPreviewPanelProps = {
  vehicleId: string
  firstRegistrationDate: string | null
  co2Wltp: number | null
  co2Nedc: number | null
  typenscheinNo: string | null
  novaClass: string | null
  initialNetPriceEuro?: number | string | null
}

type PreviewMode = 'v1' | 'eu_used_m1_2024'

function display(value: string | number | null): string | number {
  return value ?? '—'
}

const EU_SLICE_LEGAL_BASIS =
  'Rechtsgrundlage: direkter EU/EWR-Gebrauchtimport M1 (Slice EU-M1-2024). Erstzulassung in der EU/EWR im Kalenderjahr 2024; Steuerereignis ab dieser Erstzulassung bis 31.12.2026. Tarif nach EU-Erstzulassung (at-m1-2024), Wertentwicklung nach Ihrer Angabe. Diese Vorschau ist keine NoVA-Anmeldung und kein FinanzOnline-Export.'

export function NovaPreviewPanel({
  vehicleId,
  firstRegistrationDate,
  co2Wltp,
  co2Nedc,
  typenscheinNo,
  novaClass,
  initialNetPriceEuro,
}: NovaPreviewPanelProps) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('v1')
  const [netPrice, setNetPrice] = useState(
    initialNetPriceEuro == null ? '' : String(initialNetPriceEuro),
  )
  const [taxableEventDate, setTaxableEventDate] = useState('')
  const [valueBasis, setValueBasis] = useState<'achtelung' | 'known_new_net'>(
    'achtelung',
  )
  const [originalNewNet, setOriginalNewNet] = useState('')
  const [hasCurrentCalculation, setHasCurrentCalculation] = useState(false)
  const { mutate, reset, data, error, isPending } = useNovaCalculate()

  useEffect(() => {
    setHasCurrentCalculation(false)
    reset()
    setPreviewMode('v1')
    setNetPrice(initialNetPriceEuro == null ? '' : String(initialNetPriceEuro))
    setTaxableEventDate('')
    setValueBasis('achtelung')
    setOriginalNewNet('')
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
  const originalNewNetEuro = Number(originalNewNet)
  const canCalculate =
    netPrice.trim() !== '' && Number.isFinite(netPriceEuro) && netPriceEuro >= 0
  const euSliceReady =
    previewMode !== 'eu_used_m1_2024' ||
    (taxableEventDate.trim() !== '' &&
      co2Wltp !== null &&
      Number.isInteger(co2Wltp) &&
      (valueBasis !== 'known_new_net' ||
        (originalNewNet.trim() !== '' &&
          Number.isFinite(originalNewNetEuro) &&
          originalNewNetEuro > 0)))
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

      <fieldset className="space-y-2 text-sm">
        <legend className="text-slate-600">Vorschau-Modus</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="nova-preview-mode"
            checked={previewMode === 'v1'}
            onChange={() => {
              setPreviewMode('v1')
              setValueBasis('achtelung')
              setOriginalNewNet('')
              setHasCurrentCalculation(false)
              reset()
            }}
          />
          <span>Standard-Vorschau (Steuerereignis = heute, Tarif nach Ereignisdatum)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="nova-preview-mode"
            checked={previewMode === 'eu_used_m1_2024'}
            onChange={() => {
              setPreviewMode('eu_used_m1_2024')
              setHasCurrentCalculation(false)
              reset()
            }}
          />
          <span>EU-M1-Gebrauchtimport 2024 (explizit; kein automatischer Wechsel)</span>
        </label>
      </fieldset>

      {previewMode === 'eu_used_m1_2024' ? (
        <p className="text-xs text-slate-600" role="note">
          {EU_SLICE_LEGAL_BASIS}
        </p>
      ) : null}

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
        {previewMode === 'eu_used_m1_2024' ? (
          <>
            <label className="min-w-48 space-y-1 text-sm">
              <span className="text-slate-600">Steuerereignis (Datum)</span>
              <Input
                aria-label="Steuerereignis"
                type="date"
                value={taxableEventDate}
                onChange={(event) => {
                  setTaxableEventDate(event.target.value)
                  setHasCurrentCalculation(false)
                  reset()
                }}
              />
            </label>
            <label className="min-w-48 space-y-1 text-sm">
              <span className="text-slate-600">Wertentwicklung</span>
              <select
                aria-label="Wertentwicklung"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={valueBasis}
                onChange={(event) => {
                  setValueBasis(event.target.value as 'achtelung' | 'known_new_net')
                  setHasCurrentCalculation(false)
                  reset()
                }}
              >
                <option value="achtelung">Achtelung</option>
                <option value="known_new_net">Bekannter Neuwagen-Nettowert</option>
              </select>
            </label>
            {valueBasis === 'known_new_net' ? (
              <label className="min-w-48 space-y-1 text-sm">
                <span className="text-slate-600">Neuwagen-Nettowert (€)</span>
                <Input
                  aria-label="Neuwagen-Nettowert"
                  type="number"
                  min={0}
                  step="0.01"
                  value={originalNewNet}
                  onChange={(event) => {
                    setOriginalNewNet(event.target.value)
                    setHasCurrentCalculation(false)
                    reset()
                  }}
                />
              </label>
            ) : null}
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={
            !vehicleId || !canCalculate || !euSliceReady || isPending
          }
          onClick={() => {
            reset()
            setHasCurrentCalculation(true)
            if (previewMode === 'eu_used_m1_2024') {
              mutate({
                vehicleId,
                netPriceEuro,
                importMode: 'eu_used_m1',
                vehicleClass: 'passenger_z3',
                driveType: 'ICE',
                emissionCycle: 'WLTP',
                co2GramsPerKm: co2Wltp!,
                taxableEventDate,
                valueBasis,
                ...(valueBasis === 'known_new_net'
                  ? { originalNewNetEuro }
                  : {}),
              })
            } else {
              mutate({ vehicleId, netPriceEuro })
            }
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
          {data.tariffSelectionBasis ? (
            <div className="text-xs text-slate-600">
              Tarifwahl: {data.tariffSelectionBasis}
              {data.tariffSelectionDate ? ` (${data.tariffSelectionDate})` : ''}
            </div>
          ) : null}
          {data.intermediates ? (
            <div className="text-xs text-slate-600">
              Wertentwicklung ({data.intermediates.valueBasis}):{' '}
              {data.intermediates.valueDevelopmentFactor.numerator}/
              {data.intermediates.valueDevelopmentFactor.denominator},{' '}
              {data.intermediates.fullYearsElapsed} volle Jahre seit Erstzulassung
            </div>
          ) : null}
          <div className="text-xs text-slate-600">
            Angewandte Regeln: {data.appliedRuleIds.length ? data.appliedRuleIds.join(', ') : '—'}
          </div>
          {data.warnings.length ? (
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
              {data.warnings.map((warning) => (
                <li key={warning}>{formatNovaPreviewWarning(warning)}</li>
              ))}
            </ul>
          ) : null}
          {data.hasScopeLimitations ? (
            <p className="text-sm font-medium text-amber-800" role="status">
              Vorschau eingeschränkt – Wertentwicklung und EU-Importtarif nicht berechnet
            </p>
          ) : null}
          {data.hasUnverifiedRules ? (
            <p className="text-sm font-medium text-amber-800">
              Vorschau - Steuerberater-Bestätigung ausstehend
            </p>
          ) : null}
          {previewMode === 'eu_used_m1_2024' ? (
            <p className="text-xs text-slate-600" role="status">
              {EU_SLICE_LEGAL_BASIS}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
