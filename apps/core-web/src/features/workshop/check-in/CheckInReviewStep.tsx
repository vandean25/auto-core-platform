import { useTranslation } from 'react-i18next'
import { formatDateTime, formatOdometerKm, formatPercent } from '@/lib/format'
import type {
  WorkshopCheckIn,
  WorkshopCheckInMedia,
} from '@/api/workshop-check-in'
import { WorkshopCheckInInspectionChecklist } from './WorkshopCheckInInspectionChecklist'
import { CheckInSignatureSlot } from './CheckInSignatureSlot'
import type { CheckInSignaturePadHandle } from './CheckInSignaturePad'
import type { CheckInDraftSnapshot } from './check-in-draft'
import type { CheckInZoneId } from './check-in-zones'
import type { RefObject } from 'react'

type Props = {
  orderId: string
  onRevisionConflict?: () => void
  orderNumber: string
  vehicleLabel: string
  draft: CheckInDraftSnapshot
  record: WorkshopCheckIn
  readOnly: boolean
  signedByName: string
  onSignedByNameChange: (value: string) => void
  acknowledged: boolean
  onAcknowledgedChange: (value: boolean) => void
  signaturePadRef: RefObject<CheckInSignaturePadHandle | null>
  signaturePreviewUrl?: string | null
  onSignatureCanvasClear?: () => void
  media: WorkshopCheckInMedia[]
  localPreviewUrls: Record<string, string>
}

export function CheckInReviewStep({
  orderId,
  onRevisionConflict,
  orderNumber,
  vehicleLabel,
  draft,
  record,
  readOnly,
  signedByName,
  onSignedByNameChange,
  acknowledged,
  onAcknowledgedChange,
  signaturePadRef,
  signaturePreviewUrl,
  onSignatureCanvasClear,
  media,
  localPreviewUrls,
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
            <dd className="text-base font-medium">
              {formatPercent(draft.fuel_level)}
            </dd>
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
          <ul className="mt-4 space-y-3 text-sm" aria-label={t('checkIn.damageListAria')}>
            {draft.damage_markers.map((marker) => (
                <li key={marker.id} className="space-y-1">
                  <div>
                    {t(`checkIn.zones.${marker.zone_id as CheckInZoneId}`)} —{' '}
                    {t(`checkIn.damageTypes.${marker.type}`)}
                    {marker.note ? ` — ${marker.note}` : ''}
                  </div>
                  {marker.media_ids.length > 0 && (
                    <ul className="flex flex-wrap gap-2" aria-label={t('checkIn.review.markerPhotosAria')}>
                      {marker.media_ids.map((mediaId) => {
                        const item = media.find((entry) => entry.id === mediaId)
                        const src = localPreviewUrls[mediaId] ?? item?.preview_url ?? undefined
                        return (
                          <li key={mediaId}>
                            {src ? (
                              <img
                                src={src}
                                alt={t('checkIn.review.markerPhotoAlt')}
                                className="h-16 w-16 rounded-md border object-cover"
                              />
                            ) : (
                              <span
                                className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted px-1 text-center text-xs text-muted-foreground"
                              >
                                {t('checkIn.review.markerPhotoAttached')}
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
            ))}
          </ul>
        )}
        {record.status === 'COMPLETED' && record.completed_at && (
          <p className="mt-4 text-sm text-green-700" data-testid="check-in-completed-banner">
            {t('checkIn.review.completedAt', {
              date: formatDateTime(record.completed_at),
            })}
          </p>
        )}
      </section>

      <WorkshopCheckInInspectionChecklist
          orderId={orderId}
          onRevisionConflict={onRevisionConflict}
        />
      <CheckInSignatureSlot
        readOnly={readOnly}
        signedByName={signedByName}
        onSignedByNameChange={onSignedByNameChange}
        acknowledged={acknowledged}
        onAcknowledgedChange={onAcknowledgedChange}
        padRef={signaturePadRef}
        signaturePreviewUrl={signaturePreviewUrl}
        onSignatureCanvasClear={onSignatureCanvasClear}
      />
    </div>
  )
}
