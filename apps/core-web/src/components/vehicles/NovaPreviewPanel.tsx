import { useEffect, useMemo, useState } from 'react'
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

function display(value: string | number | null): string | number {
  return value ?? '—'
}

function isEuM1Slice2024Candidate(firstRegistrationDate: string | null): boolean {
  if (!firstRegistrationDate) return false
  return firstRegistrationDate >= '2024-01-01' && firstRegistrationDate <= '2024-12-31'
}

function currentViennaIsoDate(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(
    new Date(),
  )
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
  const [valueBasis, setValueBasis] = useState<'achtelung' | 'known_new_net'>(
    'achtelung',
  )
  const [originalNewNet, setOriginalNewNet] = useState('')
  const [hasCurrentCalculation, setHasCurrentCalculation] = useState(false)
  const { mutate, reset, data, error, isPending } = useNovaCalculate()

  const euSliceMode = useMemo(
    () =>
      isEuM1Slice2024Candidate(firstRegistrationDate) &&
      co2Wltp !== null &&
      Number.isInteger(co2Wltp),
    [firstRegistrationDate, co2Wltp],
  )

  useEffect(() => {
    setHasCurrentCalculation(false)
    reset()
    setNetPrice(initialNetPriceEuro == null ? '' : String(initialNetPriceEuro))
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
  const knownNewNetReady =
    valueBasis !== 'known_new_net' ||
    (originalNewNet.trim() !== '' &&
      Number.isFinite(originalNewNetEuro) &&
      originalNewNetEuro > 0)
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
        {euSliceMode ? (
          <p className="mt-2 text-xs text-slate-600" role="note">
            Rechtsgrundlage: EU-M1-Gebrauchtimport 2024 (Slice EU-M1-2024) – Tarif nach
            EU-Erstzulassung, Wertentwicklung nach Angabe.
          </p>
        ) : null}
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
        {euSliceMode ? (
          <>
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
            !vehicleId || !canCalculate || !knownNewNetReady || isPending
          }
          onClick={() => {
            reset()
            setHasCurrentCalculation(true)
            if (euSliceMode) {
              mutate({
                vehicleId,
                netPriceEuro,
                importMode: 'eu_used_m1',
                vehicleClass: 'passenger_z3',
                driveType: 'ICE',
                emissionCycle: 'WLTP',
                co2GramsPerKm: co2Wltp!,
                taxableEventDate: currentViennaIsoDate(),
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
        </div>
      ) : null}
    </section>
  )
}
