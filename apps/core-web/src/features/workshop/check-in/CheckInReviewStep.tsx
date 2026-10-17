import { useTranslation } from 'react-i18next'
import { formatOdometerKm } from '@/lib/format'
import type { WorkshopCheckIn } from '@/api/workshop-check-in'
import { WorkshopCheckInInspectionChecklist } from './WorkshopCheckInInspectionChecklist'
import { CheckInSignatureSlot } from './CheckInSignatureSlot'
import type { CheckInDraftSnapshot } from './check-in-draft'

type Props = {
  orderId: string
  orderNumber: string
  vehicleLabel: string
  draft: CheckInDraftSnapshot
  record: WorkshopCheckIn
}

export function CheckInReviewStep({
  orderId,
  orderNumber,
  vehicleLabel,
  draft,
  record,
}: Props) {
  const { t } = useTranslation('workshop')

  return (
    <div className="space-y-8" data-testid="check-in-step-review">
      <section aria-labelledby="check-in-review-heading">
        <h2 id="check-in-review-heading" className="text-xl font-semibold">
          {t('checkIn.steps.review.title')}
        </h2>
        <p className="text-sm text-slate-500">
          {t('checkIn.steps.review.subtitle', { orderNumber, vehicle: vehicleLabel })}
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">{t('checkIn.fields.odometer')}</dt>
            <dd className="text-base font-medium">{formatOdometerKm(draft.odometer)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('checkIn.fields.fuelLevel')}</dt>
            <dd className="text-base font-medium">{draft.fuel_level}%</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted-foreground">{t('checkIn.fields.itemsLeft')}</dt>
            <dd className="text-base">{draft.items_left || t('checkIn.review.none')}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('checkIn.fields.keyCount')}</dt>
            <dd className="text-base">{draft.key_count}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('checkIn.fields.warningLights')}</dt>
            <dd className="text-base">
              {draft.warning_lights.length > 0
                ? draft.warning_lights.join(', ')
                : t('checkIn.review.none')}
            </dd>
          </div>
        </dl>
        {draft.damage_markers.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm" aria-label={t('checkIn.damageListAria')}>
            {draft.damage_markers.map((marker) => (
              <li key={marker.id}>
                {t(`checkIn.zones.${marker.zone_id}`)} — {t(`checkIn.damageTypes.${marker.type}`)}
              </li>
            ))}
          </ul>
        )}
        {record.status === 'COMPLETED' && record.completed_at && (
          <p className="mt-4 text-sm text-green-700" data-testid="check-in-completed-banner">
            {t('checkIn.review.completedAt', {
              date: new Date(record.completed_at).toLocaleString(),
            })}
          </p>
        )}
      </section>

      <WorkshopCheckInInspectionChecklist orderId={orderId} />
      <CheckInSignatureSlot />
    </div>
  )
}
