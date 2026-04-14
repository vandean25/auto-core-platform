import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  categoryId: string
}

const EMPTY_FORM: FormState = {
  code: '',
  description: '',
  standardAw: '',
  hourlyRate: '',
  categoryId: '',
}

export function LaborOperationFormDialog({ open, onOpenChange, operation }: Props) {
  const createMutation = useCreateLaborOperation()
  const updateMutation = useUpdateLaborOperation()
  const { data: categoriesData } = useLaborCategories()

  const isEditing = !!operation

  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)

  React.useEffect(() => {
    if (open) {
      if (operation) {
        setForm({
          code: operation.code,
          description: operation.description,
          standardAw: String(operation.standardAw),
          hourlyRate: String(operation.hourlyRate),
          categoryId: (operation.categoryId as string | null) ?? '',
        })
      } else {
        setForm(EMPTY_FORM)
      }
    }
  }, [operation, open])

  const isPending = createMutation.isPending || updateMutation.isPending

  // Flatten categories including children for dropdown
  const categories = React.useMemo(
    () => flattenLaborCategories(categoriesData),
    [categoriesData]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const standardAw = parseFloat(form.standardAw)
    const hourlyRate = parseFloat(form.hourlyRate)

    if (isNaN(standardAw) || standardAw < 0) {
      toast.error('Standard AW must be a non-negative number')
      return
    }
    if (isNaN(hourlyRate) || hourlyRate <= 0) {
      toast.error('Hourly Rate must be greater than 0')
      return
    }

    try {
      if (isEditing && operation) {
        const payload: UpdateLaborOperationPayload = {
          code: form.code,
          description: form.description,
          standardAw,
          hourlyRate,
          ...(form.categoryId ? { categoryId: form.categoryId } : {}),
        }
        await updateMutation.mutateAsync({ id: operation.id, data: payload })
        toast.success('Labor operation updated')
      } else {
        const payload: CreateLaborOperationPayload = {
          code: form.code,
          description: form.description,
          standardAw,
          hourlyRate,
          ...(form.categoryId ? { categoryId: form.categoryId } : {}),
        }
        await createMutation.mutateAsync(payload)
        toast.success('Labor operation created')
      }
      onOpenChange(false)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save labor operation'
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Labor Operation' : 'New Labor Operation'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lo-code">Code</Label>
              <Input
                id="lo-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. ENG-OIL-01"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-description">Description</Label>
              <Input
                id="lo-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Operation description"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lo-standardAw">Standard AW (hrs)</Label>
              <Input
                id="lo-standardAw"
                type="number"
                step="0.01"
                min="0"
                value={form.standardAw}
                onChange={(e) => setForm({ ...form, standardAw: e.target.value })}
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lo-hourlyRate">Hourly Rate</Label>
              <Input
                id="lo-hourlyRate"
                type="number"
                step="0.01"
                min="0.01"
                value={form.hourlyRate}
                onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lo-category">Category</Label>
            <Select
              value={form.categoryId || '_none'}
              onValueChange={(v) => setForm({ ...form, categoryId: v === '_none' ? '' : v })}
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

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
