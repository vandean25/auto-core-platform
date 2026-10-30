import { useEffect, useRef, useState } from 'react'
import { useForm, useFieldArray, type FieldPath, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { components } from '@/api/generated/openapi'
import { getBadRequestFields, normalizeApiError, translateApiError } from '@/api/api-error'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { mobileNativeSelectClass } from '@/lib/mobile-field-text'
import { TyreWheelFields } from './TyreWheelFields'

type Payload = components['schemas']['CreateTyreMeasurementDto']
type Wheel = components['schemas']['CreateTyreWheelDto']
type Measurement = components['schemas']['TyreMeasurementResponseDto']
type TreadField = 'treadInnerMm' | 'treadMiddleMm' | 'treadOuterMm'
export type TyreMeasurementValues = Omit<Payload, 'wheels'> & {
  wheels: (Omit<Wheel, TreadField> & Partial<Pick<Wheel, TreadField>>)[]
}
const POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const

function newWheel(position: Wheel['position'], initial?: Measurement): TyreMeasurementValues['wheels'][number] {
  const base: TyreMeasurementValues['wheels'][number] = {
    position,
    treadInnerMm: undefined,
    treadMiddleMm: undefined,
    treadOuterMm: undefined,
    season: 'SUMMER',
    construction: 'RADIAL',
    winterMarking: 'NONE',
    brand: '',
    model: '',
    size: '',
    dot: '',
  }
  const previous = initial?.wheels.find((wheel) => wheel.position === position)
  if (!previous) return base
  return {
    ...base,
    season: previous.season,
    construction: previous.construction,
    winterMarking: previous.winterMarking,
    brand: previous.brand,
    model: previous.model,
    size: previous.size,
    dot: previous.dot,
  }
}

export type TyreMeasurementFormState = { isDirty: boolean; isSubmitting: boolean }

type Props = {
  onStateChange?: (state: TyreMeasurementFormState) => void
  onSave: (body: Payload) => Promise<unknown>
  initial?: Measurement
  disabled?: boolean
  submitLabel?: string
  onPhoto?: (file: File) => Promise<string>
  pendingMediaIds?: string[]
  mediaUrls?: Record<string, string>
}

function getServerFieldPath(path: string, body: Payload): FieldPath<Payload> | null {
  if (path === 'weightClass') return path
  const match = /^wheels\.(\d+)\.(treadInnerMm|treadMiddleMm|treadOuterMm|dot|season|construction|winterMarking|brand|model|size)$/.exec(path)
  if (!match || !body.wheels[Number(match[1])]) return null
  const field = match[2] as keyof Omit<Wheel, 'position' | 'mediaId'>
  return `wheels.${Number(match[1])}.${field}`
}

function getServerFieldErrors(error: unknown, body: Payload, invalidMessage: string) {
  const normalized = normalizeApiError(error)
  const dotIndex = body.wheels.findIndex((wheel) => wheel.position === normalized?.params.position)
  if (normalized?.code?.startsWith('TYRE_DOT_') && dotIndex >= 0) {
    return [{ path: `wheels.${dotIndex}.dot` as const, message: translateApiError(error) }]
  }
  return getBadRequestFields(error)
    .map((path) => getServerFieldPath(path, body))
    .filter((path): path is FieldPath<Payload> => path !== null)
    .map((path) => ({ path, message: invalidMessage }))
}

function WeightClassField({ form }: { form: UseFormReturn<TyreMeasurementValues> }) {
  const { t } = useTranslation('workshop')
  const error = form.formState.errors.weightClass
  return (
    <div className="space-y-1">
      <Label htmlFor="tyre-weight-class">{t('tyreReport.weightClass')}</Label>
      <select id="tyre-weight-class" className={`${mobileNativeSelectClass} min-h-11`}
        aria-invalid={Boolean(error)} aria-describedby={error ? 'tyre-weight-class-error' : undefined}
        {...form.register('weightClass')}>
        {(['UP_TO_3500_KG', 'OVER_3500_KG'] as const).map((weight) => <option key={weight} value={weight}>{t(`tyreReport.weights.${weight}`)}</option>)}
      </select>
      {error && <p id="tyre-weight-class-error" className="text-sm text-destructive">{error.message}</p>}
    </div>
  )
}

function DiscardDialogContent({ onConfirm }: { onConfirm: () => void }) {
  const { t } = useTranslation(['workshop', 'common'])
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('tyreReport.discard')}</AlertDialogTitle>
        <AlertDialogDescription>{t('tyreReport.discardDescription')}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>{t('tyreReport.confirmDiscard')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

function FormStatusMessages({ pending, error, pendingText }: { pending: boolean; error?: string; pendingText: string }) {
  return (
    <>
      {pending && <p role="status" className="text-sm text-muted-foreground">{pendingText}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </>
  )
}

function MeasurementSaveControls({ form, pending, disabled, submitLabel }: {
  form: UseFormReturn<TyreMeasurementValues>
  pending: boolean
  disabled: boolean
  submitLabel?: string
}) {
  const { t } = useTranslation(['workshop', 'common'])
  const saving = form.formState.isSubmitting
  const error = form.formState.errors.root
  const isLocked = disabled || saving
  const canSave = !isLocked && !pending
  const defaultLabel = saving ? t('tyreReport.saving') : t('tyreReport.save')
  const buttonLabel = submitLabel ?? defaultLabel

  return (
    <>
      <FormStatusMessages pending={pending} error={error?.message} pendingText={t('tyreReport.pendingPhoto')} />
      <DialogFooter>
        {form.formState.isDirty && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={isLocked} className="min-h-11">
                {t('tyreReport.discard')}
              </Button>
            </AlertDialogTrigger>
            <DiscardDialogContent onConfirm={() => form.reset()} />
          </AlertDialog>
        )}
        <Button type="submit" disabled={!canSave} className="min-h-11">
          {saving && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
          {buttonLabel}
        </Button>
      </DialogFooter>
    </>
  )
}

function isTreadValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasCompleteTreads(wheels: TyreMeasurementValues['wheels']): wheels is Wheel[] {
  return wheels.every((wheel) =>
    isTreadValue(wheel.treadInnerMm) &&
    isTreadValue(wheel.treadMiddleMm) &&
    isTreadValue(wheel.treadOuterMm),
  )
}

function applyServerErrors(
  error: unknown,
  payload: Payload,
  form: UseFormReturn<TyreMeasurementValues>,
  invalidMessage: string,
): FieldPath<Payload> | null {
  const fieldErrors = getServerFieldErrors(error, payload, invalidMessage)
  for (const { path, message } of fieldErrors) form.setError(path, { message })
  const first = fieldErrors[0]
  if (first) return first.path
  form.setError('root', { message: translateApiError(error) })
  return null
}

async function uploadWheelPhoto({
  file,
  onPhoto,
  onError,
}: {
  file: File
  onPhoto: (file: File) => Promise<string>
  onError: (err: unknown) => void
}): Promise<string | null> {
  try {
    return await onPhoto(file)
  } catch (error) {
    onError(error)
    return null
  }
}

function useFormStateSync(
  onStateChange: ((state: TyreMeasurementFormState) => void) | undefined,
  dirty: boolean,
  busy: boolean,
) {
  useEffect(() => {
    onStateChange?.({ isDirty: dirty, isSubmitting: busy })
  }, [dirty, busy, onStateChange])
  useEffect(() => () => {
    onStateChange?.({ isDirty: false, isSubmitting: false })
  }, [onStateChange])
}

function usePendingFieldFocus(
  saving: boolean,
  form: UseFormReturn<TyreMeasurementValues>,
) {
  const pendingFocus = useRef<FieldPath<Payload> | null>(null)
  useEffect(() => {
    if (!saving && pendingFocus.current) {
      form.setFocus(pendingFocus.current)
      pendingFocus.current = null
    }
  }, [saving, form])
  return pendingFocus
}

function SpareWheelToggle({
  hasSpare,
  onToggle,
}: {
  hasSpare: boolean
  onToggle: (checked: boolean) => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <Label className="flex min-h-11 items-center gap-2">
      <Checkbox
        checked={hasSpare}
        onCheckedChange={(checked) => onToggle(Boolean(checked))}
      />
      {t('tyreReport.includeSpare')}
    </Label>
  )
}

function getInitialFormValues(initial?: Measurement): TyreMeasurementValues {
  return {
    weightClass: initial?.weightClass ?? 'UP_TO_3500_KG',
    wheels: POSITIONS.map((position) => newWheel(position, initial)),
  }
}

export function TyreMeasurementForm({ onSave, onStateChange, initial, disabled = false, submitLabel, onPhoto, pendingMediaIds = [], mediaUrls = {} }: Props) {
  const { t } = useTranslation('workshop')
  const [uploading, setUploading] = useState(false)
  const form = useForm<TyreMeasurementValues>({ defaultValues: getInitialFormValues(initial) })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'wheels' })
  const wheels = form.watch('wheels')
  const pending = wheels.some((wheel) => wheel.mediaId && pendingMediaIds.includes(wheel.mediaId))
  const saving = form.formState.isSubmitting
  const dirty = form.formState.isDirty

  useFormStateSync(onStateChange, dirty, saving || uploading)
  const pendingFocus = usePendingFieldFocus(saving, form)

  const isBusy = disabled || uploading || pending
  const save = form.handleSubmit(async (body) => {
    if (isBusy || !hasCompleteTreads(body.wheels)) return
    const payload: Payload = { ...body, wheels: body.wheels }
    form.clearErrors()
    pendingFocus.current = null
    try {
      await onSave(payload)
      form.reset(body)
    } catch (error) {
      pendingFocus.current = applyServerErrors(error, payload, form, t('tyreReport.invalidField'))
    }
  })

  const capturePhoto = async (file: File, index: number) => {
    if (!onPhoto) return
    setUploading(true)
    const mediaId = await uploadWheelPhoto({
      file,
      onPhoto,
      onError: (err) => form.setError('root', { message: translateApiError(err) }),
    })
    if (mediaId) form.setValue(`wheels.${index}.mediaId`, mediaId, { shouldDirty: true })
    setUploading(false)
  }

  const toggleSpare = (checked: boolean) => {
    if (checked) append(newWheel('SPARE', initial))
    else remove(4)
  }

  return (
    <form onSubmit={save} className="min-w-0 space-y-4">
      <fieldset disabled={disabled || saving || uploading} className="min-w-0 space-y-4">
        <WeightClassField form={form} />
        <SpareWheelToggle hasSpare={fields.length === 5} onToggle={toggleSpare} />
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((wheel, index) => <TyreWheelFields key={wheel.id} form={form} index={index} position={wheel.position}
            onPhoto={onPhoto ? capturePhoto : undefined} mediaUrls={mediaUrls} />)}
        </div>
      </fieldset>
      <MeasurementSaveControls form={form} pending={pending} disabled={disabled || uploading} submitLabel={submitLabel} />
    </form>
  )
}
