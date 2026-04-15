import * as React from 'react'
import { AlertCircle, CloudCheck, Loader2, Plus } from 'lucide-react'
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

const EMPTY_FITMENT: FitmentState = {
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

export function LaborOperationFormDialog({ open, onOpenChange, operation }: Props) {
  const createMutation = useCreateLaborOperation()
  const updateMutation = useUpdateLaborOperation()
  const { data: categoriesData } = useLaborCategories()

  const isEditing = !!operation

  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [saveStatus, setSaveStatus] = React.useState<'saved' | 'saving' | 'error'>('saved')
  const [errors, setErrors] = React.useState<ValidationState>({})
  const [dirty, setDirty] = React.useState(false)
  const [isHydrating, setIsHydrating] = React.useState(false)
  const createdOperationIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setIsHydrating(true)
      if (operation) {
        setForm({
          code: operation.code,
          description: operation.description,
          standardAw: String(operation.standardAw),
          hourlyRate: String(operation.hourlyRate),
          internalCost: typeof operation.internalCost === 'number' ? String(operation.internalCost) : '',
          categoryId: (operation.categoryId as string | null) ?? '',
          isActive: operation.isActive,
          fitments: (operation.fitments ?? []).map((fitment) => ({
            make: fitment.make ?? '',
            model: fitment.model ?? '',
            yearFrom: fitment.yearFrom != null ? String(fitment.yearFrom) : '',
            yearTo: fitment.yearTo != null ? String(fitment.yearTo) : '',
            engineCode: typeof fitment.engineCode === 'string' ? fitment.engineCode : '',
          })),
        })
        createdOperationIdRef.current = operation.id
      } else {
        setForm(EMPTY_FORM)
        createdOperationIdRef.current = null
      }
      setSaveStatus('saved')
      setErrors({})
      setDirty(false)
      window.setTimeout(() => {
        setIsHydrating(false)
      }, 0)
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

  const validateForm = React.useCallback((currentForm: FormState): ValidationState => {
    const nextErrors: ValidationState = {}
    const standardAw = Number(currentForm.standardAw)
    const hourlyRate = Number(currentForm.hourlyRate)
    const internalCost = currentForm.internalCost.trim() === '' ? undefined : Number(currentForm.internalCost)

    if (!currentForm.code.trim()) {
      nextErrors.code = 'Code is required'
    }
    if (!currentForm.description.trim()) {
      nextErrors.description = 'Description is required'
    }
    if (!Number.isFinite(standardAw) || standardAw < 0) {
      nextErrors.standardAw = 'Standard AW must be a non-negative number'
    }
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      nextErrors.hourlyRate = 'Hourly Rate must be greater than 0'
    }
    if (internalCost !== undefined && (!Number.isFinite(internalCost) || internalCost < 0)) {
      nextErrors.internalCost = 'Internal Cost must be zero or greater'
    }

    const fitmentErrors: NonNullable<ValidationState['fitments']> = []
    currentForm.fitments.forEach((fitment, index) => {
      const hasAnyValue =
        fitment.make.trim() ||
        fitment.model.trim() ||
        fitment.yearFrom.trim() ||
        fitment.yearTo.trim() ||
        fitment.engineCode.trim()

      if (!hasAnyValue) {
        return
      }

      const currentFitmentErrors: NonNullable<ValidationState['fitments']>[number] = {}
      if (!fitment.make.trim()) {
        currentFitmentErrors.make = 'Make is required'
      }
      if (!fitment.model.trim()) {
        currentFitmentErrors.model = 'Model is required'
      }

      const yearFrom = fitment.yearFrom.trim() === '' ? undefined : Number(fitment.yearFrom)
      const yearTo = fitment.yearTo.trim() === '' ? undefined : Number(fitment.yearTo)

      if (yearFrom !== undefined && !Number.isInteger(yearFrom)) {
        currentFitmentErrors.yearFrom = 'Year From must be an integer'
      }
      if (yearTo !== undefined && !Number.isInteger(yearTo)) {
        currentFitmentErrors.yearTo = 'Year To must be an integer'
      }
      if (
        yearFrom !== undefined &&
        yearTo !== undefined &&
        Number.isInteger(yearFrom) &&
        Number.isInteger(yearTo) &&
        yearFrom > yearTo
      ) {
        currentFitmentErrors.yearTo = 'Year To must be greater than or equal to Year From'
      }

      if (Object.keys(currentFitmentErrors).length > 0) {
        fitmentErrors[index] = currentFitmentErrors
      }
    })

    if (fitmentErrors.length > 0) {
      nextErrors.fitments = fitmentErrors
    }

    return nextErrors
  }, [])

  const buildPayload = React.useCallback((currentForm: FormState): CreateLaborOperationPayload => {
    const fitments = currentForm.fitments
      .map((fitment) => ({
        make: fitment.make.trim(),
        model: fitment.model.trim(),
        yearFrom: fitment.yearFrom.trim() === '' ? undefined : Number(fitment.yearFrom),
        yearTo: fitment.yearTo.trim() === '' ? undefined : Number(fitment.yearTo),
        engineCode: fitment.engineCode.trim() || undefined,
      }))
      .filter((fitment) => fitment.make || fitment.model || fitment.yearFrom || fitment.yearTo || fitment.engineCode)

    return {
      code: currentForm.code.trim(),
      description: currentForm.description.trim(),
      standardAw: Number(currentForm.standardAw),
      hourlyRate: Number(currentForm.hourlyRate),
      ...(currentForm.internalCost.trim() !== '' ? { internalCost: Number(currentForm.internalCost) } : {}),
      ...(currentForm.categoryId ? { categoryId: currentForm.categoryId } : {}),
      isActive: currentForm.isActive,
      ...(fitments.length > 0 ? { fitments } : {}),
    }
  }, [])

  const performAutoSave = React.useCallback(async () => {
    const currentErrors = validateForm(form)
    if (Object.keys(currentErrors).length > 0) {
      setErrors(currentErrors)
      setSaveStatus('error')
      return
    }

    const payload = buildPayload(form)
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

      setErrors({})
      setSaveStatus('saved')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save labor operation'
      setSaveStatus('error')
      if (message.toLowerCase().includes('code') && message.toLowerCase().includes('already exists')) {
        setErrors((prev) => ({ ...prev, code: message }))
        return
      }
      setErrors((prev) => ({ ...prev, code: message }))
    }
  }, [buildPayload, createMutation, form, operation, updateMutation, validateForm])

  React.useEffect(() => {
    if (!open || isHydrating || !dirty) {
      return
    }

    const timeout = window.setTimeout(() => {
      void performAutoSave()
    }, AUTO_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [dirty, form, isHydrating, open, performAutoSave])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Labor Operation' : 'New Labor Operation'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-2 text-sm text-muted-foreground min-h-5">
              {saveStatus === 'saving' && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <CloudCheck className="h-3.5 w-3.5 text-green-600" />
                  <span>All changes saved</span>
                </>
              )}
              {saveStatus === 'error' && (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                  <span className="text-red-600 font-medium">Save failed</span>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lo-code">Code</Label>
              <Input
                id="lo-code"
                value={form.code}
                onChange={(e) => setField('code', e.target.value)}
                placeholder="e.g. ENG-OIL-01"
                required
              />
              {errors.code && <p className="text-xs text-red-600">{errors.code}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-description">Description</Label>
              <Input
                id="lo-description"
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="Operation description"
                required
              />
              {errors.description && <p className="text-xs text-red-600">{errors.description}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lo-standardAw">Standard AW (hrs)</Label>
              <Input
                id="lo-standardAw"
                type="number"
                step="0.01"
                min="0"
                value={form.standardAw}
                onChange={(e) => setField('standardAw', e.target.value)}
                placeholder="0.00"
                required
              />
              {errors.standardAw && <p className="text-xs text-red-600">{errors.standardAw}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-hourlyRate">Hourly Rate</Label>
              <Input
                id="lo-hourlyRate"
                type="number"
                step="0.01"
                min="0.01"
                value={form.hourlyRate}
                onChange={(e) => setField('hourlyRate', e.target.value)}
                placeholder="0.00"
                required
              />
              {errors.hourlyRate && <p className="text-xs text-red-600">{errors.hourlyRate}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-internalCost">Internal Cost</Label>
              <Input
                id="lo-internalCost"
                type="number"
                step="0.01"
                min="0"
                value={form.internalCost}
                onChange={(e) => setField('internalCost', e.target.value)}
                placeholder="Optional"
              />
              {errors.internalCost && <p className="text-xs text-red-600">{errors.internalCost}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lo-category">Category</Label>
              <Select
                value={form.categoryId || '_none'}
                onValueChange={(v) => setField('categoryId', v === '_none' ? '' : v)}
              >
                <SelectTrigger id="lo-category">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No category</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-active">Active</Label>
              <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                <Checkbox
                  id="lo-active"
                  checked={form.isActive}
                  onCheckedChange={(checked) => setField('isActive', checked === true)}
                />
                <span className="text-sm">{form.isActive ? 'Active' : 'Inactive'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Fitments</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setField('fitments', [...form.fitments, { ...EMPTY_FITMENT }])}>
                <Plus className="h-4 w-4 mr-1" />
                +
              </Button>
            </div>

            {form.fitments.map((fitment, index) => (
              <div key={`fitment-${index}`} className="rounded-md border p-3 space-y-3">
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor={`fitment-make-${index}`}>Make</Label>
                    <Input
                      id={`fitment-make-${index}`}
                      value={fitment.make}
                      onChange={(e) => setFitmentField(index, 'make', e.target.value)}
                    />
                    {errors.fitments?.[index]?.make && <p className="text-xs text-red-600">{errors.fitments[index]?.make}</p>}
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor={`fitment-model-${index}`}>Model</Label>
                    <Input
                      id={`fitment-model-${index}`}
                      value={fitment.model}
                      onChange={(e) => setFitmentField(index, 'model', e.target.value)}
                    />
                    {errors.fitments?.[index]?.model && <p className="text-xs text-red-600">{errors.fitments[index]?.model}</p>}
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor={`fitment-year-from-${index}`}>Year From</Label>
                    <Input
                      id={`fitment-year-from-${index}`}
                      type="number"
                      value={fitment.yearFrom}
                      onChange={(e) => setFitmentField(index, 'yearFrom', e.target.value)}
                    />
                    {errors.fitments?.[index]?.yearFrom && <p className="text-xs text-red-600">{errors.fitments[index]?.yearFrom}</p>}
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor={`fitment-year-to-${index}`}>Year To</Label>
                    <Input
                      id={`fitment-year-to-${index}`}
                      type="number"
                      value={fitment.yearTo}
                      onChange={(e) => setFitmentField(index, 'yearTo', e.target.value)}
                    />
                    {errors.fitments?.[index]?.yearTo && <p className="text-xs text-red-600">{errors.fitments[index]?.yearTo}</p>}
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label htmlFor={`fitment-engine-code-${index}`}>Engine Code</Label>
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
                      aria-label="×"
                      onClick={() => setField('fitments', form.fitments.filter((_, currentIndex) => currentIndex !== index))}
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
              Close
            </Button>
            <Button type="button" onClick={() => void performAutoSave()} disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
