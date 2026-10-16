import { useState } from 'react'
import {
  useApplyInspectionImport,
  usePreviewInspectionImport,
} from '@/api/vehicle-inspection-imports'
import { Button } from '@/components/ui/button'
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
import type { components } from '@/api/generated/openapi'
import { describeInspectionImportError } from '@/api/inspection-import-errors'

type InspectionImportPreview =
  components['schemas']['InspectionImportPreviewResponseDto']

type InspectionImportDialogProps = {
  vehicleId: string
  connectionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const INSPECTION_IMPORT_STATE_LABELS: Record<string, string> = {
  READY_FOR_REVIEW: 'Bereit zur Übernahme',
  UNCONFIRMED: 'Nicht bestätigt',
  CONFLICT: 'Konflikt — manuelle Prüfung erforderlich',
  APPLIED: 'Übernommen',
  RECEIVED: 'Empfangen',
  REJECTED: 'Abgelehnt',
}

function qualificationLabel(state: string): string {
  if (state === 'NOT_VERIFIED') {
    return 'Qualifikation nicht verifiziert'
  }
  return 'Qualifikation nicht verifiziert'
}

export function InspectionImportDialog({
  vehicleId,
  connectionId,
  open,
  onOpenChange,
}: InspectionImportDialogProps) {
  const [reference, setReference] = useState('SYNTH-RESULT-001')
  const [preview, setPreview] = useState<InspectionImportPreview | null>(null)
  const previewMutation = usePreviewInspectionImport(vehicleId)
  const applyMutation = useApplyInspectionImport(vehicleId)

  const reset = () => {
    setPreview(null)
    previewMutation.reset()
    applyMutation.reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Begutachtung importieren</DialogTitle>
          <DialogDescription>
            Externes EBV-Ergebnis prüfen und einmalig übernehmen. Qualifikation
            des Prüfers ist nicht verifiziert.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Label htmlFor='native-ref'>Ergebnisreferenz</Label>
              <Input
                id='native-ref'
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </div>
            {previewMutation.isError ? (
              <p className='text-sm text-destructive'>
                {describeInspectionImportError(previewMutation.error)}
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
                  INSPECTION_IMPORT_STATE_LABELS[preview.state] ??
                  preview.state
                }
              />
            </div>
            {preview.reviewed_fields.display_unconfirmed ? (
              <p className='text-amber-700'>
                {String(preview.reviewed_fields.display_unconfirmed)}
              </p>
            ) : null}
            <p>
              Begutachtet:{' '}
              <span className='font-medium'>
                {preview.reviewed_fields.inspected_on}
              </span>
            </p>
            <p>
              Plakette bis:{' '}
              <span className='font-medium'>
                {preview.reviewed_fields.plate_valid_until ?? '—'}
              </span>
            </p>
            <p className='text-muted-foreground text-xs'>
              {qualificationLabel(preview.reviewed_fields.qualification_state)}
            </p>
            {applyMutation.isError ? (
              <p className='text-sm text-destructive'>
                {describeInspectionImportError(applyMutation.error)}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter className='gap-2'>
          {!preview ? (
            <Button
              disabled={previewMutation.isPending || !reference.trim()}
              onClick={async () => {
                const result = await previewMutation.mutateAsync({
                  connection_id: connectionId,
                  native_result_reference: reference.trim(),
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
                const fingerprint = preview.fingerprint
                if (!fingerprint) return
                await applyMutation.mutateAsync({
                  importId: preview.id,
                  fingerprint,
                  version: preview.version,
                })
                onOpenChange(false)
                reset()
              }}
            >
              Übernehmen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
