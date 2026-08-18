import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PartRequestForm } from '../types'

type RequestPartDialogProps = {
  open: boolean
  partForm: PartRequestForm
  partFormError: string
  pending: boolean
  onOpenChange: (open: boolean) => void
  onFormChange: (updates: Partial<PartRequestForm>) => void
  onSubmit: () => void
}

export function RequestPartDialog({
  open,
  partForm,
  partFormError,
  pending,
  onOpenChange,
  onFormChange,
  onSubmit,
}: RequestPartDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a Part</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div>
            <Label htmlFor="part-item-no">Part Number / SKU</Label>
            <Input
              id="part-item-no"
              value={partForm.itemNo}
              onChange={(event) => onFormChange({ itemNo: event.target.value })}
              placeholder="e.g. OIL-FILTER-01"
              className="mt-1 min-h-[44px]"
            />
          </div>
          <div>
            <Label htmlFor="part-description">Description</Label>
            <Input
              id="part-description"
              value={partForm.description}
              onChange={(event) => onFormChange({ description: event.target.value })}
              placeholder="e.g. Oil filter — 2.0 TDI"
              className="mt-1 min-h-[44px]"
            />
          </div>
          <div>
            <Label htmlFor="part-qty">Quantity</Label>
            <Input
              id="part-qty"
              type="number"
              min="0.01"
              step="0.01"
              value={partForm.qty}
              onChange={(event) => onFormChange({ qty: event.target.value })}
              className="mt-1 min-h-[44px]"
            />
          </div>
          {partFormError && <p className="text-sm text-red-500">{partFormError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Submit Request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
