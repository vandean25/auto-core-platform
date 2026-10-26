import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export function NovaPreviewPanel({
  vehicleId,
  firstRegistrationDate,
  co2Wltp,
  co2Nedc,
  typenscheinNo,
  novaClass,
  initialNetPriceEuro,
}: NovaPreviewPanelProps) {
  const { t } = useTranslation('vehicles')
  const emDash = t('shared.emDash')

  function display(value: string | number | null): string | number {
    return value ?? emDash
  }

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

  const euSliceLegalBasis = t('novaPreview.euSliceLegalBasis')

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="nova-preview-title">
      <div>
        <h3 id="nova-preview-title" className="text-sm font-semibold text-slate-700">
          {t('novaPreview.title')}
        </h3>
        <div className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
          <div>{t('novaPreview.firstRegistration', { value: display(firstRegistrationDate) })}</div>
          <div>{t('novaPreview.co2Wltp', { value: display(co2Wltp) })}</div>
          <div>{t('novaPreview.co2Nedc', { value: display(co2Nedc) })}</div>
          <div>{t('novaPreview.typenschein', { value: display(typenscheinNo) })}</div>
          <div>{t('novaPreview.novaClass', { value: display(novaClass) })}</div>
        </div>
      </div>

      <fieldset className="space-y-2 text-sm">
        <legend className="text-slate-600">{t('novaPreview.previewMode')}</legend>
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
          <span>{t('novaPreview.modeStandard')}</span>
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
          <span>{t('novaPreview.modeEuUsedM1')}</span>
        </label>
      </fieldset>

      {previewMode === 'eu_used_m1_2024' ? (
        <p className="text-xs text-slate-600" role="note">
          {euSliceLegalBasis}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 space-y-1 text-sm">
          <span className="text-slate-600">{t('novaPreview.netPrice')}</span>
          <Input
            aria-label={t('novaPreview.netPriceAria')}
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
              <span className="text-slate-600">{t('novaPreview.taxableEventDate')}</span>
              <Input
                aria-label={t('novaPreview.taxableEventAria')}
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
              <span className="text-slate-600">{t('novaPreview.valueDevelopment')}</span>
              <select
                aria-label={t('novaPreview.valueDevelopmentAria')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm md:text-sm"
                value={valueBasis}
                onChange={(event) => {
                  setValueBasis(event.target.value as 'achtelung' | 'known_new_net')
                  setHasCurrentCalculation(false)
                  reset()
                }}
              >
                <option value="achtelung">{t('novaPreview.valueBasisAchtelung')}</option>
                <option value="known_new_net">{t('novaPreview.valueBasisKnownNewNet')}</option>
              </select>
            </label>
            {valueBasis === 'known_new_net' ? (
              <label className="min-w-48 space-y-1 text-sm">
                <span className="text-slate-600">{t('novaPreview.originalNewNet')}</span>
                <Input
                  aria-label={t('novaPreview.originalNewNetAria')}
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
          {isPending ? t('novaPreview.calculating') : t('novaPreview.calculate')}
        </Button>
      </div>

      {calculationError?.code === 'MISSING_CO2' ? (
        <p className="text-sm text-amber-700" role="status">
          {t('novaPreview.missingCo2')}
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
            <span className="text-slate-600">{t('novaPreview.calculatedNova')}</span>
            <strong>{formatCurrency(data.novaAmountEuro)}</strong>
          </div>
          <div className="text-xs text-slate-600">
            {t('novaPreview.tariffVersion', { id: data.tariffVersionId })}
          </div>
          {data.tariffSelectionBasis ? (
            <div className="text-xs text-slate-600">
              {t('novaPreview.tariffSelection', {
                basis: data.tariffSelectionBasis,
                dateSuffix: data.tariffSelectionDate
                  ? t('novaPreview.tariffSelectionDateSuffix', { date: data.tariffSelectionDate })
                  : '',
              })}
            </div>
          ) : null}
          {data.intermediates ? (
            <div className="text-xs text-slate-600">
              {t('novaPreview.valueDevelopmentDetail', {
                basis: data.intermediates.valueBasis,
                numerator: data.intermediates.valueDevelopmentFactor.numerator,
                denominator: data.intermediates.valueDevelopmentFactor.denominator,
                years: data.intermediates.fullYearsElapsed,
              })}
            </div>
          ) : null}
          <div className="text-xs text-slate-600">
            {t('novaPreview.appliedRules', {
              rules: data.appliedRuleIds.length ? data.appliedRuleIds.join(', ') : emDash,
            })}
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
              {t('novaPreview.scopeLimited')}
            </p>
          ) : null}
          {data.hasUnverifiedRules ? (
            <p className="text-sm font-medium text-amber-800">
              {t('novaPreview.unverifiedRules')}
            </p>
          ) : null}
          {previewMode === 'eu_used_m1_2024' ? (
            <p className="text-xs text-slate-600" role="status">
              {euSliceLegalBasis}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
