import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { components } from '@/api/generated/openapi'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mobileNativeSelectClass } from '@/lib/mobile-field-text'
import type { TyreMeasurementValues } from './TyreMeasurementForm'

type Wheel = components['schemas']['CreateTyreWheelDto']
const POINTS = ['treadInnerMm', 'treadMiddleMm', 'treadOuterMm'] as const
const TEXT_FIELDS = ['brand', 'model', 'size', 'dot'] as const
const CHOICES = {
  season: [
    { value: 'SUMMER', label: 'tyreReport.seasons.SUMMER' },
    { value: 'WINTER', label: 'tyreReport.seasons.WINTER' },
    { value: 'ALL_SEASON', label: 'tyreReport.seasons.ALL_SEASON' },
  ],
  construction: [
    { value: 'RADIAL', label: 'tyreReport.constructions.RADIAL' },
    { value: 'DIAGONAL', label: 'tyreReport.constructions.DIAGONAL' },
  ],
  winterMarking: [
    { value: 'NONE', label: 'tyreReport.markings.NONE' },
    { value: 'M_S', label: 'tyreReport.markings.M_S' },
    { value: 'ALPINE', label: 'tyreReport.markings.ALPINE' },
  ],
} as const

type Props = {
  form: UseFormReturn<TyreMeasurementValues>
  index: number
  position: Wheel['position']
  onPhoto?: (file: File, index: number) => Promise<void>
  mediaUrls: Record<string, string>
}

type DetailField = typeof TEXT_FIELDS[number] | keyof typeof CHOICES
const DETAIL_FIELDS: DetailField[] = [...TEXT_FIELDS, ...Object.keys(CHOICES) as (keyof typeof CHOICES)[]]

function TyreWheelDetailField({ form, index, positionLabel, field }: {
  form: UseFormReturn<TyreMeasurementValues>
  index: number
  positionLabel: string
  field: DetailField
}) {
  const { t } = useTranslation('workshop')
  const path = `wheels.${index}.${field}` as const
  const error = form.formState.errors.wheels?.[index]?.[field]
  const choices = field in CHOICES ? CHOICES[field as keyof typeof CHOICES] : undefined
  const controlProps = {
    id: path,
    'aria-label': `${positionLabel} ${t(`tyreReport.fields.${field}`)}`,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${path}-error` : undefined,
    ...form.register(path),
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={path}>{t(`tyreReport.fields.${field}`)}</Label>
      {choices ? (
        <select {...controlProps} className={`${mobileNativeSelectClass} min-h-11`}>
          {choices.map((choice) => <option key={choice.value} value={choice.value}>{t(choice.label)}</option>)}
        </select>
      ) : (
        <Input {...controlProps} className="min-h-11" maxLength={field === 'dot' ? 4 : 100} />
      )}
      {error && <p id={`${path}-error`} className="text-sm text-destructive">{error.message}</p>}
    </div>
  )
}

export function TyreWheelFields({ form, index, position, onPhoto, mediaUrls }: Props) {
  const { t } = useTranslation('workshop')
  const positionLabel = t(`tyreReport.positions.${position}`)
  const mediaId = form.watch(`wheels.${index}.mediaId`)

  const copyDetails = () => {
    const source = form.getValues(`wheels.${index}`)
    for (const [target] of form.getValues('wheels').entries()) {
      for (const field of ['brand', 'model', 'size'] as const) {
        form.setValue(`wheels.${target}.${field}`, source[field], { shouldDirty: true })
      }
    }
  }

  return (
    <fieldset className="min-w-0 space-y-3 rounded-md border p-4">
      <legend className="px-1 font-semibold">{positionLabel}</legend>
      <div className="grid grid-cols-3 gap-2">
        {POINTS.map((point) => {
          const path = `wheels.${index}.${point}` as const
          const error = form.formState.errors.wheels?.[index]?.[point]
          return <div key={point} className="min-w-0 space-y-1">
            <Label htmlFor={path}>{t(`tyreReport.fields.${point}`)}</Label>
            <Input id={path} aria-label={`${positionLabel} ${t(`tyreReport.fields.${point}`)}`} type="number" inputMode="decimal" min={0} max={20} step={0.01} required className="min-h-11"
              aria-invalid={Boolean(error)} aria-describedby={error ? `${path}-error` : undefined}
              {...form.register(path, { valueAsNumber: true, required: t('tyreReport.invalidField'), min: { value: 0, message: t('tyreReport.invalidField') }, max: { value: 20, message: t('tyreReport.invalidField') } })} />
            {error && <p id={`${path}-error`} className="text-sm text-destructive">{error.message}</p>}
          </div>
        })}
      </div>
      {DETAIL_FIELDS.map((field) => <TyreWheelDetailField key={field} form={form} index={index} positionLabel={positionLabel} field={field} />)}
      {onPhoto && <div className="space-y-2">
        <Label className="flex min-h-11 cursor-pointer items-center rounded-md border p-2 focus-within:ring-1 focus-within:ring-ring">
          {t('tyreReport.capture')}
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only min-h-11" aria-label={`${positionLabel} ${t('tyreReport.capture')}`}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onPhoto(file, index)
              event.target.value = ''
            }} />
        </Label>
        {mediaId && mediaUrls[mediaId] && <img src={mediaUrls[mediaId]} alt={t('tyreReport.photo', { position: positionLabel })} className="h-24 w-24 rounded-md object-cover" />}
      </div>}
      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal" onClick={copyDetails}>{t('tyreReport.copy')}</Button>
      </DialogFooter>
    </fieldset>
  )
}
