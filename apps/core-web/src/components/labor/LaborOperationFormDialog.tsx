import * as React from 'react'
import type { TFunction } from 'i18next'
import { AlertCircle, CloudCheck, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useCreateLaborOperation,
  useUpdateLaborOperation,
  useLaborCategories,
  flattenLaborCategories,
} from '@/api/labor'
import type { LaborOperation, CreateLaborOperationPayload, UpdateLaborOperationPayload } from '@/api/labor'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  operation?: LaborOperation | null
}

interface FormState {
  code: string
  description: string
  standardAw: string
  hourlyRate: string
  internalCost: string
  categoryId: string
  isActive: boolean
  fitments: FitmentState[]
}

interface FitmentState {
  id: string
  make: string
  model: string
  yearFrom: string
  yearTo: string
  engineCode: string
}

interface ValidationState {
  code?: string
  description?: string
  standardAw?: string
  hourlyRate?: string
  internalCost?: string
  fitments?: Array<{
    make?: string
    model?: string
    yearFrom?: string
    yearTo?: string
  }>
}

const AUTO_SAVE_DEBOUNCE_MS = 750
const MIN_YEAR = 1900
const MAX_YEAR = 2100

function createFitment(initial?: Partial<Omit<FitmentState, 'id'>>): FitmentState {
  const generatedId =
    globalThis.crypto?.randomUUID?.() ??
    `fitment-${Date.now()}-${Math.trunc(globalThis.performance?.now?.() ?? 0)}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id: generatedId,
    make: initial?.make ?? '',
    model: initial?.model ?? '',
    yearFrom: initial?.yearFrom ?? '',
    yearTo: initial?.yearTo ?? '',
    engineCode: initial?.engineCode ?? '',
  }
}

const EMPTY_FITMENT_TEMPLATE: Omit<FitmentState, 'id'> = {
  make: '',
  model: '',
  yearFrom: '',
  yearTo: '',
  engineCode: '',
}

const EMPTY_FORM: FormState = {
  code: '',
  description: '',
  standardAw: '',
  hourlyRate: '',
  internalCost: '',
  categoryId: '',
  isActive: true,
  fitments: [],
}

function serializeFormState(formState: FormState) {
  return JSON.stringify({
    ...formState,
    code: formState.code.trim(),
    description: formState.description.trim(),
    internalCost: formState.internalCost.trim(),
    fitments: formState.fitments.map((fitment) => ({
      make: fitment.make.trim(),
      model: fitment.model.trim(),
      yearFrom: fitment.yearFrom.trim(),
      yearTo: fitment.yearTo.trim(),
      engineCode: fitment.engineCode.trim(),
    })),
  })
}

function operationToFormState(operation: LaborOperation): FormState {
  const categoryId = typeof operation.categoryId === 'string' ? operation.categoryId : ''

  return {
    code: operation.code,
    description: operation.description,
    standardAw: String(operation.standardAw),
    hourlyRate: String(operation.hourlyRate),
    internalCost: typeof operation.internalCost === 'number' ? String(operation.internalCost) : '',
    categoryId,
    isActive: operation.isActive,
    fitments: (operation.fitments ?? []).map((fitment) =>
      createFitment({
        make: fitment.make ?? '',
        model: fitment.model ?? '',
        yearFrom: fitment.yearFrom != null ? String(fitment.yearFrom) : '',
        yearTo: fitment.yearTo != null ? String(fitment.yearTo) : '',
        engineCode: typeof fitment.engineCode === 'string' ? fitment.engineCode : '',
      })
    ),
  }
}

function parseAndValidateYear(
  rawYear: string,
  label: string,
  t: TFunction<'settings'>,
): { num?: number; error?: string } {
  const trimmed = rawYear.trim()
  if (!trimmed) return {}
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) {
    return { error: t('labor.operationForm.validation.yearInteger', { label }) }
  }
  if (parsed < MIN_YEAR || parsed > MAX_YEAR) {
    return {
      error: t('labor.operationForm.validation.yearRange', {
        label,
        min: MIN_YEAR,
        max: MAX_YEAR,
      }),
    }
  }
  return { num: parsed }
}

function validateSingleFitment(
  fitment: FitmentState,
  t: TFunction<'settings'>,
): {
  make?: string
  model?: string
  yearFrom?: string
  yearTo?: string
} | null {
  const hasAnyValue =
    fitment.make.trim() ||
    fitment.model.trim() ||
    fitment.yearFrom.trim() ||
    fitment.yearTo.trim() ||
    fitment.engineCode.trim()

  if (!hasAnyValue) {
    return null
  }

  const currentFitmentErrors: {
    make?: string
    model?: string
    yearFrom?: string
    yearTo?: string
  } = {}

  if (!fitment.make.trim()) {
    currentFitmentErrors.make = t('labor.operationForm.validation.makeRequired')
  }
  if (!fitment.model.trim()) {
    currentFitmentErrors.model = t('labor.operationForm.validation.modelRequired')
  }

  const from = parseAndValidateYear(fitment.yearFrom, t('labor.operationForm.fitments.yearFrom'), t)
  if (from.error) currentFitmentErrors.yearFrom = from.error

  const to = parseAndValidateYear(fitment.yearTo, t('labor.operationForm.fitments.yearTo'), t)
  if (to.error) currentFitmentErrors.yearTo = to.error

  if (
    from.num !== undefined &&
    to.num !== undefined &&
    from.num > to.num
  ) {
    currentFitmentErrors.yearTo = t('labor.operationForm.validation.yearToBeforeFrom')
  }

  return Object.keys(currentFitmentErrors).length > 0 ? currentFitmentErrors : null
}

function validateLaborOperationForm(
  currentForm: FormState,
  t: TFunction<'settings'>,
): ValidationState {
  const nextErrors: ValidationState = {}
  const standardAwRaw = currentForm.standardAw.trim()
  const hourlyRate = Number(currentForm.hourlyRate)
  const internalCost =
    currentForm.internalCost.trim() === '' ? undefined : Number(currentForm.internalCost)

  if (!currentForm.code.trim()) {
    nextErrors.code = t('labor.operationForm.validation.codeRequired')
  }
  if (!currentForm.description.trim()) {
    nextErrors.description = t('labor.operationForm.validation.descriptionRequired')
  }
  if (standardAwRaw === '') {
    nextErrors.standardAw = t('labor.operationForm.validation.standardAwRequired')
  } else {
    const standardAw = Number(standardAwRaw)
    if (!Number.isFinite(standardAw) || standardAw < 0) {
      nextErrors.standardAw = t('labor.operationForm.validation.standardAwInvalid')
    }
  }
  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
    nextErrors.hourlyRate = t('labor.operationForm.validation.hourlyRateInvalid')
  }
  if (internalCost !== undefined && (!Number.isFinite(internalCost) || internalCost < 0)) {
    nextErrors.internalCost = t('labor.operationForm.validation.internalCostInvalid')
  }

  const fitmentErrors: NonNullable<ValidationState['fitments']> = []
  currentForm.fitments.forEach((fitment, index) => {
    const err = validateSingleFitment(fitment, t)
    if (err) {
      fitmentErrors[index] = err
    }
  })

  if (fitmentErrors.length > 0) {
    nextErrors.fitments = fitmentErrors
  }

  return nextErrors
}

function buildLaborOperationPayload(currentForm: FormState): CreateLaborOperationPayload {
  const internalCostNumber =
    currentForm.internalCost.trim() === '' ? undefined : Number(currentForm.internalCost)
  const fitments = currentForm.fitments
    .map((fitment) => ({
      make: fitment.make.trim(),
      model: fitment.model.trim(),
      yearFrom: fitment.yearFrom.trim() === '' ? undefined : Number(fitment.yearFrom),
      yearTo: fitment.yearTo.trim() === '' ? undefined : Number(fitment.yearTo),
      engineCode: fitment.engineCode.trim() || undefined,
    }))
    .filter(
      (fitment) =>
        fitment.make ||
        fitment.model ||
        fitment.yearFrom !== undefined ||
        fitment.yearTo !== undefined ||
        fitment.engineCode
    )

  return {
    code: currentForm.code.trim(),
    description: currentForm.description.trim(),
    standardAw: Number(currentForm.standardAw),
    hourlyRate: Number(currentForm.hourlyRate),
    ...(internalCostNumber !== undefined ? { internalCost: internalCostNumber } : {}),
    ...(currentForm.categoryId ? { categoryId: currentForm.categoryId } : {}),
    isActive: currentForm.isActive,
    ...(fitments.length > 0 ? { fitments } : {}),
  }
}

export function LaborOperationFormDialog({ open, onOpenChange, operation }: Props) {
  const { t } = useTranslation('settings')
  const createMutation = useCreateLaborOperation()
  const updateMutation = useUpdateLaborOperation()
  const { data: categoriesData } = useLaborCategories()

  const isEditing = !!operation

  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saved' | 'saving' | 'error'>('idle')
  const [errors, setErrors] = React.useState<ValidationState>({})
  const [saveErrorMessage, setSaveErrorMessage] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [isHydrating, setIsHydrating] = React.useState(false)
  const createdOperationIdRef = React.useRef<string | null>(null)
  const lastSavedSnapshotRef = React.useRef(serializeFormState(EMPTY_FORM))
  const formRef = React.useRef<FormState>(EMPTY_FORM)
  const isSavingRef = React.useRef(false)
  const hasQueuedSaveRef = React.useRef(false)

  React.useEffect(() => {
    formRef.current = form
  }, [form])

  React.useEffect(() => {
    if (!open) {
      return
    }

    setIsHydrating(true)
    if (operation) {
      const nextForm = operationToFormState(operation)
      setForm(nextForm)
      lastSavedSnapshotRef.current = serializeFormState(nextForm)
      createdOperationIdRef.current = operation.id
      setSaveStatus('saved')
    } else {
      setForm(EMPTY_FORM)
      lastSavedSnapshotRef.current = serializeFormState(EMPTY_FORM)
      createdOperationIdRef.current = null
      setSaveStatus('idle')
    }
    setErrors({})
    setSaveErrorMessage(null)
    setDirty(false)
    const hydrationTimeout = window.setTimeout(() => {
      setIsHydrating(false)
    }, 0)

    return () => {
      window.clearTimeout(hydrationTimeout)
    }
  }, [operation, open])

  const isPending = createMutation.isPending || updateMutation.isPending

  // Flatten categories including children for dropdown
  const categories = React.useMemo(
    () => flattenLaborCategories(categoriesData),
    [categoriesData]
  )

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setDirty(true)
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const setFitmentField = (index: number, field: keyof FitmentState, value: string) => {
    setDirty(true)
    setErrors((prev) => {
      const nextFitmentErrors = [...(prev.fitments ?? [])]
      nextFitmentErrors[index] = { ...nextFitmentErrors[index], [field]: undefined }
      return { ...prev, fitments: nextFitmentErrors }
    })
    setForm((prev) => ({
      ...prev,
      fitments: prev.fitments.map((fitment, fitmentIndex) =>
        fitmentIndex === index ? { ...fitment, [field]: value } : fitment
      ),
    }))
  }

  const performAutoSave = React.useCallback(
    async (formToSave: FormState) => {
      const saveSnapshot = serializeFormState(formToSave)
      if (saveSnapshot === lastSavedSnapshotRef.current) {
        setSaveErrorMessage(null)
        setDirty(false)
        setSaveStatus(createdOperationIdRef.current ? 'saved' : 'idle')
        return
      }
      if (isSavingRef.current) {
        hasQueuedSaveRef.current = true
        return
      }

      const currentErrors = validateLaborOperationForm(formToSave, t)
      if (Object.keys(currentErrors).length > 0) {
        setSaveErrorMessage(null)
        setErrors(currentErrors)
        setSaveStatus('error')
        return
      }

      isSavingRef.current = true
      const payload = buildLaborOperationPayload(formToSave)
      // The last failure stays visible while a retry runs. The revert and success paths clear it.
      setSaveStatus('saving')

      try {
        const targetId = operation?.id ?? createdOperationIdRef.current

        if (targetId) {
          await updateMutation.mutateAsync({
            id: targetId,
            data: payload as UpdateLaborOperationPayload,
          })
        } else {
          const created = await createMutation.mutateAsync(payload)
          createdOperationIdRef.current = created.id
        }

        const latestSnapshot = serializeFormState(formRef.current)
        if (latestSnapshot === saveSnapshot) {
          setErrors({})
          setSaveErrorMessage(null)
          lastSavedSnapshotRef.current = saveSnapshot
          setDirty(false)
          setSaveStatus('saved')
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : t('labor.operationForm.saveFailed')
        if (serializeFormState(formRef.current) === saveSnapshot) {
          setSaveStatus('error')
          setSaveErrorMessage(message)
        }
      } finally {
        isSavingRef.current = false
        const shouldQueueSave =
          hasQueuedSaveRef.current || serializeFormState(formRef.current) !== saveSnapshot
        if (shouldQueueSave) {
          hasQueuedSaveRef.current = false
          void performAutoSave(formRef.current)
        }
      }
    },
    [createMutation, operation, t, updateMutation]
  )

  React.useEffect(() => {
    if (!open || isHydrating || !dirty || saveStatus === 'saving') {
      return
    }

    if (serializeFormState(form) === lastSavedSnapshotRef.current) {
      setSaveErrorMessage(null)
      setDirty(false)
      setSaveStatus(createdOperationIdRef.current ? 'saved' : 'idle')
      return
    }

    const timeout = window.setTimeout(() => {
      void performAutoSave(form)
    }, AUTO_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [dirty, form, isHydrating, open, performAutoSave, saveStatus])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('labor.operationForm.editTitle') : t('labor.operationForm.createTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-2 text-sm text-muted-foreground min-h-5">
              {saveStatus === 'saving' && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('labor.operationForm.saveStatus.saving')}</span>
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <CloudCheck className="h-3.5 w-3.5 text-green-600" />
                  <span>{t('labor.operationForm.saveStatus.saved')}</span>
                </>
              )}
              {saveStatus === 'error' && (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                  <span className="text-red-600 font-medium">{t('labor.operationForm.saveStatus.failed')}</span>
                </>
              )}
            </div>
          </div>

          {saveErrorMessage ? (
            <p role="alert" className="text-xs text-red-600">{saveErrorMessage}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lo-code">{t('labor.operationForm.code')}</Label>
              <Input
                id="lo-code"
                aria-invalid={Boolean(errors.code)}
                aria-describedby={errors.code ? 'lo-code-error' : undefined}
                value={form.code}
                onChange={(e) => setField('code', e.target.value)}
                placeholder={t('labor.operationForm.codePlaceholder')}
                required
              />
              {errors.code && <p id="lo-code-error" className="text-xs text-red-600">{errors.code}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-description">{t('labor.operationForm.descriptionLabel')}</Label>
              <Input
                id="lo-description"
                aria-invalid={Boolean(errors.description)}
                aria-describedby={errors.description ? 'lo-description-error' : undefined}
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder={t('labor.operationForm.descriptionPlaceholder')}
                required
              />
              {errors.description && <p id="lo-description-error" className="text-xs text-red-600">{errors.description}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lo-standardAw">{t('labor.operationForm.standardAw')}</Label>
              <Input
                id="lo-standardAw"
                type="number"
                step="0.01"
                min="0"
                aria-invalid={Boolean(errors.standardAw)}
                aria-describedby={errors.standardAw ? 'lo-standardAw-error' : undefined}
                value={form.standardAw}
                onChange={(e) => setField('standardAw', e.target.value)}
                placeholder="0.00"
                required
              />
              {errors.standardAw && <p id="lo-standardAw-error" className="text-xs text-red-600">{errors.standardAw}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-hourlyRate">{t('labor.operationForm.hourlyRate')}</Label>
              <Input
                id="lo-hourlyRate"
                type="number"
                step="0.01"
                min="0.01"
                aria-invalid={Boolean(errors.hourlyRate)}
                aria-describedby={errors.hourlyRate ? 'lo-hourlyRate-error' : undefined}
                value={form.hourlyRate}
                onChange={(e) => setField('hourlyRate', e.target.value)}
                placeholder="0.00"
                required
              />
              {errors.hourlyRate && <p id="lo-hourlyRate-error" className="text-xs text-red-600">{errors.hourlyRate}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-internalCost">{t('labor.operationForm.internalCost')}</Label>
              <Input
                id="lo-internalCost"
                type="number"
                step="0.01"
                min="0"
                aria-invalid={Boolean(errors.internalCost)}
                aria-describedby={errors.internalCost ? 'lo-internalCost-error' : undefined}
                value={form.internalCost}
                onChange={(e) => setField('internalCost', e.target.value)}
                placeholder={t('labor.operationForm.internalCostPlaceholder')}
              />
              {errors.internalCost && <p id="lo-internalCost-error" className="text-xs text-red-600">{errors.internalCost}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lo-category">{t('labor.operationForm.category')}</Label>
              <Select
                value={form.categoryId || '_none'}
                onValueChange={(v) => setField('categoryId', v === '_none' ? '' : v)}
              >
                <SelectTrigger id="lo-category">
                  <SelectValue placeholder={t('labor.operationForm.categoryPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">{t('labor.operationForm.noCategory')}</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-active">{t('labor.operationForm.active')}</Label>
              <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                <Checkbox
                  id="lo-active"
                  checked={form.isActive}
                  onCheckedChange={(checked) => setField('isActive', checked === true)}
                />
                <span className="text-sm">{form.isActive ? t('labor.operationForm.active') : t('labor.operationForm.inactive')}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{t('labor.operationForm.fitments.title')}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('labor.operationForm.fitments.addAria')}
                onClick={() => setField('fitments', [...form.fitments, createFitment(EMPTY_FITMENT_TEMPLATE)])}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {form.fitments.map((fitment, index) => (
              <div key={fitment.id} className="rounded-md border p-3 space-y-3">
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor={`fitment-make-${index}`}>{t('labor.operationForm.fitments.make')}</Label>
                    <Input
                      id={`fitment-make-${index}`}
                      aria-invalid={Boolean(errors.fitments?.[index]?.make)}
                      aria-describedby={errors.fitments?.[index]?.make ? `fitment-make-${index}-error` : undefined}
                      value={fitment.make}
                      onChange={(e) => setFitmentField(index, 'make', e.target.value)}
                    />
                    {errors.fitments?.[index]?.make && <p id={`fitment-make-${index}-error`} className="text-xs text-red-600">{errors.fitments[index]?.make}</p>}
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor={`fitment-model-${index}`}>{t('labor.operationForm.fitments.model')}</Label>
                    <Input
                      id={`fitment-model-${index}`}
                      aria-invalid={Boolean(errors.fitments?.[index]?.model)}
                      aria-describedby={errors.fitments?.[index]?.model ? `fitment-model-${index}-error` : undefined}
                      value={fitment.model}
                      onChange={(e) => setFitmentField(index, 'model', e.target.value)}
                    />
                    {errors.fitments?.[index]?.model && <p id={`fitment-model-${index}-error`} className="text-xs text-red-600">{errors.fitments[index]?.model}</p>}
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor={`fitment-year-from-${index}`}>{t('labor.operationForm.fitments.yearFrom')}</Label>
                    <Input
                      id={`fitment-year-from-${index}`}
                      type="number"
                      aria-invalid={Boolean(errors.fitments?.[index]?.yearFrom)}
                      aria-describedby={errors.fitments?.[index]?.yearFrom ? `fitment-year-from-${index}-error` : undefined}
                      value={fitment.yearFrom}
                      onChange={(e) => setFitmentField(index, 'yearFrom', e.target.value)}
                    />
                    {errors.fitments?.[index]?.yearFrom && <p id={`fitment-year-from-${index}-error`} className="text-xs text-red-600">{errors.fitments[index]?.yearFrom}</p>}
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor={`fitment-year-to-${index}`}>{t('labor.operationForm.fitments.yearTo')}</Label>
                    <Input
                      id={`fitment-year-to-${index}`}
                      type="number"
                      aria-invalid={Boolean(errors.fitments?.[index]?.yearTo)}
                      aria-describedby={errors.fitments?.[index]?.yearTo ? `fitment-year-to-${index}-error` : undefined}
                      value={fitment.yearTo}
                      onChange={(e) => setFitmentField(index, 'yearTo', e.target.value)}
                    />
                    {errors.fitments?.[index]?.yearTo && <p id={`fitment-year-to-${index}-error`} className="text-xs text-red-600">{errors.fitments[index]?.yearTo}</p>}
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label htmlFor={`fitment-engine-code-${index}`}>{t('labor.operationForm.fitments.engineCode')}</Label>
                    <Input
                      id={`fitment-engine-code-${index}`}
                      value={fitment.engineCode}
                      onChange={(e) => setFitmentField(index, 'engineCode', e.target.value)}
                    />
                  </div>
                  <div className="col-span-1 pt-6">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('labor.operationForm.fitments.removeAria')}
                      onClick={() => setField('fitments', form.fitments.filter((currentFitment) => currentFitment.id !== fitment.id))}
                    >
                      ×
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('labor.operationForm.close')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!dirty) return
                void performAutoSave(form)
              }}
              disabled={isPending || !dirty}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('labor.operationForm.saveNow')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
