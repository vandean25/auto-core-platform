import { useState } from 'react'
import {
  useApplyWorkshopMeasurement,
  useInspectionDeviceSources,
  usePreviewWorkshopMeasurement,
  useWorkshopMeasurements,
} from '@/api/workshop-measurements'
import { describeMeasurementError } from '@/api/measurement-errors'
import {
  MEASUREMENT_IMPORT_STATE_LABELS,
  MEASUREMENT_QUARANTINE_LABELS,
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
  const measurementsQuery = useWorkshopMeasurements(orderId)
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

  const resetDialog = () => {
    setPreview(null)
    previewMutation.reset()
    applyMutation.reset()
  }

  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0'>
        <div>
          <CardTitle>Geräteergebnis Bremsen</CardTitle>
          <p className='text-sm text-muted-foreground'>
            Externe Bremsmessung prüfen und als Nachweis übernehmen.
          </p>
        </div>
        <Button
          variant='outline'
          onClick={() => {
            resetDialog()
            setDialogOpen(true)
          }}
        >
          Messung importieren
        </Button>
      </CardHeader>
      <CardContent className='space-y-2'>
        {(measurementsQuery.data?.data ?? []).length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            Noch keine Bremsmessungen für diesen Auftrag.
          </p>
        ) : (
          <ul className='space-y-2 text-sm'>
            {(measurementsQuery.data?.data ?? []).map((row) => (
              <li
                key={row.id}
                className='flex flex-wrap items-center gap-2 rounded-md border p-2'
              >
                <StatusBadge
                  status={row.state}
                  label={
                    MEASUREMENT_IMPORT_STATE_LABELS[row.state] ?? row.state
                  }
                />
                <span className='text-muted-foreground'>
                  {row.native_measurement_reference}
                </span>
                {row.quarantine_reason ? (
                  <span className='text-amber-700'>
                    {MEASUREMENT_QUARANTINE_LABELS[row.quarantine_reason] ??
                      row.quarantine_reason}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
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
            <DialogTitle>Bremsmessung importieren</DialogTitle>
            <DialogDescription>
              Quellenreferenz aus dem Werkstattnetz — Werte sind schreibgeschützt.
            </DialogDescription>
          </DialogHeader>

          {!preview ? (
            <div className='space-y-3'>
              <div className='space-y-1'>
                <Label htmlFor='device-source'>Messgerät</Label>
                <select
                  id='device-source'
                  className='w-full rounded-md border px-2 py-2 text-sm'
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
                <Label htmlFor='measurement-ref'>Messreferenz</Label>
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
                <span className='text-muted-foreground'>Status:</span>
                <StatusBadge
                  status={preview.state}
                  label={
                    MEASUREMENT_IMPORT_STATE_LABELS[preview.state] ??
                    preview.state
                  }
                />
              </div>
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
                    Achse {wheel.axle} {wheel.side}: {wheel.force} {wheel.unit}
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
                Vorschau
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
                Übernehmen
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
