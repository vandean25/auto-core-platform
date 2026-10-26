import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useApplyWorkshopMeasurement,
  useInspectionDeviceSources,
  usePreviewWorkshopMeasurement,
  useWorkshopMeasurements,
} from '@/api/workshop-measurements'
import { describeMeasurementError } from '@/api/measurement-errors'
import { mobileNativeSelectClass } from '@/lib/mobile-field-text'
import {
  MEASUREMENT_IMPORT_STATE_LABELS,
  MEASUREMENT_QUARANTINE_LABELS,
  MEASUREMENT_WHEEL_SIDE_LABELS,
} from '@/api/measurement-labels'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBadge } from '@/components/status/StatusBadge'

type WorkshopOrderMeasurementsSectionProps = {
  orderId: string
}

export function WorkshopOrderMeasurementsSection({
  orderId,
}: WorkshopOrderMeasurementsSectionProps) {
  const { t } = useTranslation('workshop')
  const [page, setPage] = useState(1)
  const measurementsQuery = useWorkshopMeasurements(orderId, page)
  const deviceSourcesQuery = useInspectionDeviceSources()
  const previewMutation = usePreviewWorkshopMeasurement(orderId)
  const applyMutation = useApplyWorkshopMeasurement(orderId)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [reference, setReference] = useState('SYNTH-NATIVE-RESULT-1')
  const [deviceSourceId, setDeviceSourceId] = useState('')
  const [preview, setPreview] = useState<
    Awaited<ReturnType<typeof previewMutation.mutateAsync>> | null
  >(null)

  const deviceSources = deviceSourcesQuery.data?.data ?? []
  const selectedDeviceId = deviceSourceId || deviceSources[0]?.id || ''
  const meta = measurementsQuery.data?.meta
  const totalPages = meta?.pageCount ?? 1

  const resetDialog = () => {
    setPreview(null)
    previewMutation.reset()
    applyMutation.reset()
  }

  return (
    <Card className='min-w-0 overflow-hidden'>
      <CardHeader className='flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between'>
        <div className='min-w-0'>
          <CardTitle>{t('measurementsSection.title')}</CardTitle>
          <p className='text-sm text-muted-foreground'>{t('measurementsSection.description')}</p>
        </div>
        <Button
          variant='outline'
          className='shrink-0 self-start sm:self-center'
          onClick={() => {
            resetDialog()
            setDialogOpen(true)
          }}
        >
          {t('measurementsSection.import')}
        </Button>
      </CardHeader>
      <CardContent className='space-y-2'>
        {(measurementsQuery.data?.data ?? []).length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            {t('measurementsSection.empty')}
          </p>
        ) : (
          <ul className='space-y-2 text-sm'>
            {(measurementsQuery.data?.data ?? []).map((row) => (
              <li
                key={row.id}
                className='space-y-1 rounded-md border p-2'
              >
                <div className='flex flex-wrap items-center gap-2'>
                  <StatusBadge
                    status={row.state}
                    label={
                      MEASUREMENT_IMPORT_STATE_LABELS[row.state] ?? row.state
                    }
                  />
                  <span className='min-w-0 break-all text-muted-foreground'>
                    {row.native_measurement_reference}
                  </span>
                  {row.quarantine_reason ? (
                    <span className='text-amber-700'>
                      {MEASUREMENT_QUARANTINE_LABELS[row.quarantine_reason] ??
                        row.quarantine_reason}
                    </span>
                  ) : null}
                </div>
                {row.applied_measurement ? (
                  <div className='text-muted-foreground'>
                    {row.applied_measurement.device_serial ? (
                      <p>
                        {t('measurementsSection.device', {
                          serial: row.applied_measurement.device_serial,
                        })}
                      </p>
                    ) : null}
                    <ul className='grid grid-cols-2 gap-1'>
                      {row.applied_measurement.wheels.map((wheel) => (
                        <li key={`${row.id}-${wheel.axle}-${wheel.side}`}>
                          {t('measurementsSection.axleWheel', {
                            axle: wheel.axle,
                            side:
                              MEASUREMENT_WHEEL_SIDE_LABELS[wheel.side] ?? wheel.side,
                            force: wheel.force,
                            unit: wheel.unit,
                          })}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {totalPages > 1 ? (
          <div className='flex items-center justify-end gap-2 pt-1'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t('measurementsSection.back')}
            </Button>
            <span className='text-xs text-muted-foreground'>
              {t('measurementsSection.page', { page, total: totalPages })}
            </span>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={page >= totalPages}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              {t('measurementsSection.forward')}
            </Button>
          </div>
        ) : null}
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) resetDialog()
          setDialogOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('measurementsSection.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('measurementsSection.dialogDescription')}</DialogDescription>
          </DialogHeader>

          {!preview ? (
            <div className='space-y-3'>
              <div className='space-y-1'>
                <Label htmlFor='device-source'>{t('measurementsSection.deviceLabel')}</Label>
                <select
                  id='device-source'
                  className={mobileNativeSelectClass}
                  value={selectedDeviceId}
                  onChange={(event) => setDeviceSourceId(event.target.value)}
                >
                  {deviceSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.device_model} ({source.device_serial})
                    </option>
                  ))}
                </select>
              </div>
              <div className='space-y-1'>
                <Label htmlFor='measurement-ref'>{t('measurementsSection.referenceLabel')}</Label>
                <Input
                  id='measurement-ref'
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
              {previewMutation.isError ? (
                <p className='text-sm text-destructive'>
                  {describeMeasurementError(previewMutation.error)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className='space-y-2 text-sm'>
              <div className='flex items-center gap-2'>
                <span className='text-muted-foreground'>{t('measurementsSection.status')}</span>
                <StatusBadge
                  status={preview.state}
                  label={
                    MEASUREMENT_IMPORT_STATE_LABELS[preview.state] ??
                    preview.state
                  }
                />
              </div>
              <p className='text-muted-foreground'>
                {t('measurementsSection.device', {
                  serial: preview.reviewed_fields.device_serial,
                })}
              </p>
              {preview.reviewed_fields.quarantine_reason ? (
                <p className='text-amber-700'>
                  {MEASUREMENT_QUARANTINE_LABELS[
                    preview.reviewed_fields.quarantine_reason
                  ] ?? preview.reviewed_fields.quarantine_reason}
                </p>
              ) : null}
              <ul className='grid grid-cols-2 gap-1'>
                {preview.reviewed_fields.wheels.map((wheel) => (
                  <li key={`${wheel.axle}-${wheel.side}`}>
                    {t('measurementsSection.axleWheel', {
                      axle: wheel.axle,
                      side: MEASUREMENT_WHEEL_SIDE_LABELS[wheel.side] ?? wheel.side,
                      force: wheel.force,
                      unit: wheel.unit,
                    })}
                  </li>
                ))}
              </ul>
              {applyMutation.isError ? (
                <p className='text-sm text-destructive'>
                  {describeMeasurementError(applyMutation.error)}
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter className='gap-2'>
            {!preview ? (
              <Button
                disabled={
                  previewMutation.isPending ||
                  !reference.trim() ||
                  !selectedDeviceId
                }
                onClick={async () => {
                  const result = await previewMutation.mutateAsync({
                    device_source_id: selectedDeviceId,
                    native_measurement_reference: reference.trim(),
                  })
                  setPreview(result)
                }}
              >
                {t('measurementsSection.preview')}
              </Button>
            ) : (
              <Button
                disabled={
                  applyMutation.isPending ||
                  preview.state !== 'READY_FOR_REVIEW' ||
                  !preview.fingerprint
                }
                onClick={async () => {
                  if (!preview.fingerprint) return
                  await applyMutation.mutateAsync({
                    importId: preview.id,
                    fingerprint: preview.fingerprint,
                    version: preview.version,
                  })
                  setDialogOpen(false)
                  resetDialog()
                }}
              >
                {t('measurementsSection.apply')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
