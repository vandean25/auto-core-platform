import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/status/StatusBadge'
import { GewaehrleistungFristen } from '@/components/vehicles/GewaehrleistungFristen'
import type { VehicleSale, VehicleStockDetail } from '@/api/vehicle-stock'
import { gewaehrleistungStatusBadge, negotiatedShorteningBlockReason } from '@/lib/vehicle-sale-warranty'
import type { VehicleSaleForm } from './useVehicleSaleForm'

const TEXTAREA_CLASS =
  'min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

/** Consumer classification and the negotiated shortening, with why the shortening is blocked or was refused. */
function ShorteningFields({
  form,
  locked,
  blockReason,
  saveError,
  message,
  clearSaveError,
}: {
  form: VehicleSaleForm
  locked: boolean
  blockReason: string | null
  saveError: string | null
  message: string | null
  clearSaveError: () => void
}) {
  const { t } = useTranslation('vehicleStock')
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.buyerIsConsumer}
          disabled={locked}
          onChange={(event) => form.changeBuyerIsConsumer(event.target.checked)}
        />
        {t('sale.warranty.consumerBuyer')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.shorteningNegotiated}
          disabled={
            locked ||
            !form.buyerIsConsumer ||
            (blockReason !== null && !form.shorteningNegotiated)
          }
          aria-invalid={saveError !== null || (form.shorteningNegotiated && blockReason !== null)}
          aria-describedby={message ? 'shortening-block-reason' : undefined}
          onChange={(event) => {
            clearSaveError()
            form.setShorteningNegotiated(event.target.checked)
          }}
        />
        {t('sale.warranty.shorteningNegotiated')}
      </label>
      {message ? (
        <p
          id="shortening-block-reason"
          role={saveError ? 'alert' : undefined}
          className="text-xs text-rose-600"
        >
          {message}
        </p>
      ) : null}
    </>
  )
}

/** The optional Garantie the dealer gives on top of the statutory Gewährleistung. */
function GarantieFields({ form, locked }: { form: VehicleSaleForm; locked: boolean }) {
  const { t } = useTranslation('vehicleStock')
  return (
    <div className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-medium">{t('sale.warranty.optionalTitle')}</h3>
      <label className="block space-y-1 text-sm">
        <span className="text-slate-500">{t('sale.warranty.months')}</span>
        <Input
          aria-label={t('sale.warranty.monthsAria')}
          type="number"
          min={1}
          max={120}
          step={1}
          disabled={locked}
          aria-invalid={!form.garantie.valid}
          aria-describedby={form.garantie.valid ? undefined : 'garantie-months-error'}
          value={form.garantieMonthsInput}
          onChange={(event) => form.changeGarantieMonths(event.target.value)}
        />
      </label>
      {form.garantie.valid ? null : (
        <p id="garantie-months-error" role="alert" className="text-xs text-rose-600">{t('sale.warranty.monthsError')}</p>
      )}
      <label className="block space-y-1 text-sm">
        <span className="text-slate-500">{t('sale.warranty.terms')}</span>
        <textarea
          aria-label={t('sale.warranty.terms')}
          maxLength={2000}
          disabled={locked || form.garantie.value === null}
          className={TEXTAREA_CLASS}
          value={form.garantieTerms}
          onChange={(event) => form.setGarantieTerms(event.target.value)}
        />
      </label>
      <p className="text-xs text-slate-500">
        {t('sale.warranty.termsHint')}
      </p>
    </div>
  )
}

export function VehicleSaleWarrantySection({
  form,
  sale,
  vehicle,
  locked,
  shorteningSaveError,
  clearShorteningSaveError,
}: {
  form: VehicleSaleForm
  sale: VehicleSale | undefined
  vehicle: VehicleStockDetail | undefined
  locked: boolean
  shorteningSaveError: string | null
  clearShorteningSaveError: () => void
}) {
  const { t } = useTranslation('vehicleStock')
  const shorteningBlockReason = negotiatedShorteningBlockReason({
    buyerIsConsumer: form.buyerIsConsumer,
    firstRegistrationDate: vehicle?.first_registration_date ?? null,
    handoverDate: form.handoverDate,
  })
  const warrantyBadge = sale?.gewaehrleistung_status
    ? gewaehrleistungStatusBadge(sale.gewaehrleistung_status)
    : null

  return (
    <section aria-labelledby="gewaehrleistung-form-title" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="gewaehrleistung-form-title" className="font-medium">{t('sale.gewaehrleistung')}</h2>
        {warrantyBadge ? <StatusBadge status={warrantyBadge.status} label={warrantyBadge.label} /> : null}
      </div>
      {sale?.gewaehrleistung_ends_on ? <GewaehrleistungFristen sale={sale} /> : null}
      <label className="block space-y-1 text-sm">
        <span className="text-slate-500">{t('sale.contractDate')}</span>
        <Input
          aria-label={t('sale.contractDate')}
          type="date"
          disabled={locked}
          value={form.contractDate}
          onChange={(event) => form.setContractDate(event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-slate-500">{t('sale.handoverDate')}</span>
        <Input
          aria-label={t('sale.handoverDate')}
          type="date"
          disabled={locked}
          value={form.handoverDate}
          onChange={(event) => form.setHandoverDate(event.target.value)}
        />
      </label>
      <ShorteningFields
        form={form}
        locked={locked}
        blockReason={shorteningBlockReason}
        saveError={shorteningSaveError}
        message={shorteningSaveError ?? shorteningBlockReason}
        clearSaveError={clearShorteningSaveError}
      />
      <label className="block space-y-1 text-sm">
        <span className="text-slate-500">{t('sale.warranty.note')}</span>
        <textarea
          aria-label={t('sale.warranty.note')}
          disabled={locked}
          className={TEXTAREA_CLASS}
          value={form.warrantyNote}
          onChange={(event) => form.setWarrantyNote(event.target.value)}
        />
      </label>
      <GarantieFields form={form} locked={locked} />
      <p className="text-xs text-slate-500">{t('sale.warranty.repairsNote')}</p>
    </section>
  )
}
