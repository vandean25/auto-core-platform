import { useEffect, useRef, useState } from 'react'
import { useForm, useFieldArray, type FieldPath, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { components } from '@/api/generated/openapi'
import { getBadRequestFields, normalizeApiError, translateApiError } from '@/api/api-error'
import { Button } from '@/components/ui/button'
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
  const previous = initial?.wheels.find((wheel) => wheel.position === position)
  return {
    position,
    season: previous?.season ?? 'SUMMER', construction: previous?.construction ?? 'RADIAL',
    winterMarking: previous?.winterMarking ?? 'NONE', brand: previous?.brand ?? '',
    model: previous?.model ?? '', size: previous?.size ?? '', dot: previous?.dot ?? '',
  }
}

type Props = {
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

function MeasurementSaveControls({ form, pending, disabled, submitLabel }: {
  form: UseFormReturn<TyreMeasurementValues>
  pending: boolean
  disabled: boolean
  submitLabel?: string
}) {
  const { t } = useTranslation('workshop')
  const saving = form.formState.isSubmitting
  const error = form.formState.errors.root
  return (
    <>
      {pending && <p role="status" className="text-sm text-muted-foreground">{t('tyreReport.pendingPhoto')}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <Button type="submit" disabled={disabled || saving} className="min-h-11">
        {saving && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
        {submitLabel ?? (saving ? t('tyreReport.saving') : t('tyreReport.save'))}
      </Button>
    </>
  )
}

export function TyreMeasurementForm({ onSave, initial, disabled = false, submitLabel, onPhoto, pendingMediaIds = [], mediaUrls = {} }: Props) {
  const { t } = useTranslation('workshop')
  const [uploading, setUploading] = useState(false)
  const form = useForm<TyreMeasurementValues>({ defaultValues: {
    weightClass: initial?.weightClass ?? 'UP_TO_3500_KG',
    wheels: POSITIONS.map((position) => newWheel(position, initial)),
  } })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'wheels' })
  const wheels = form.watch('wheels')
  const pending = wheels.some((wheel) => wheel.mediaId && pendingMediaIds.includes(wheel.mediaId))
  const saving = form.formState.isSubmitting
  const pendingFocus = useRef<FieldPath<Payload> | null>(null)
  useEffect(() => {
    if (!saving && pendingFocus.current) {
      form.setFocus(pendingFocus.current)
      pendingFocus.current = null
    }
  }, [saving, form])

  const save = form.handleSubmit(async (body) => {
    if (disabled || uploading || pending) return
    if (!body.wheels.every((wheel): wheel is Wheel =>
      [wheel.treadInnerMm, wheel.treadMiddleMm, wheel.treadOuterMm]
        .every((value) => typeof value === 'number' && Number.isFinite(value)))) return
    const payload: Payload = { ...body, wheels: body.wheels }
    form.clearErrors()
    pendingFocus.current = null
    try {
      await onSave(payload)
    } catch (error) {
      const fieldErrors = getServerFieldErrors(error, payload, t('tyreReport.invalidField'))
      pendingFocus.current = fieldErrors[0]?.path ?? null
      for (const { path, message } of fieldErrors) form.setError(path, { message })
      if (!pendingFocus.current) form.setError('root', { message: translateApiError(error) })
    }
  })

  const capturePhoto = async (file: File, index: number) => {
    if (!onPhoto) return
    setUploading(true)
    try {
      const mediaId = await onPhoto(file)
      form.setValue(`wheels.${index}.mediaId`, mediaId, { shouldDirty: true })
    } catch (error) {
      form.setError('root', { message: translateApiError(error) })
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={save} className="min-w-0 space-y-4">
      <fieldset disabled={disabled || saving || uploading} className="min-w-0 space-y-4">
        <WeightClassField form={form} />
        <Label className="flex min-h-11 items-center gap-2">
          <Checkbox checked={fields.length === 5} onCheckedChange={(checked) => checked ? append(newWheel('SPARE', initial)) : remove(4)} />
          {t('tyreReport.includeSpare')}
        </Label>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((wheel, index) => <TyreWheelFields key={wheel.id} form={form} index={index} position={wheel.position}
            onPhoto={onPhoto ? capturePhoto : undefined} mediaUrls={mediaUrls} />)}
        </div>
      </fieldset>
      <MeasurementSaveControls form={form} pending={pending} disabled={disabled || uploading || pending} submitLabel={submitLabel} />
    </form>
  )
}
