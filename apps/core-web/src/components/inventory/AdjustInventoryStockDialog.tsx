import * as React from 'react'
import { toast } from 'sonner'
import { useAdjustInventoryStock } from '@/api/inventory'
import { useLocations } from '@/api/locations'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getErrorMessage } from '@/lib/error-utils'

type AdjustInventoryStockDialogProps = {
  itemId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AdjustInventoryStockDialog({
  itemId,
  open,
  onOpenChange,
}: AdjustInventoryStockDialogProps) {
  const adjustMutation = useAdjustInventoryStock(itemId)
  const { data: locations } = useLocations({ enabled: open })
  const binLocations = React.useMemo(
    () => (locations ?? []).filter((location) => location.type === 'bin'),
    [locations],
  )
  const [locationId, setLocationId] = React.useState('')

  React.useEffect(() => {
    if (!open) {
      setLocationId('')
    }
  }, [open])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const quantity = Number(formData.get('quantity'))
    const reason = String(formData.get('reason') ?? '').trim()
    if (!locationId || Number.isNaN(quantity) || quantity === 0 || !reason) {
      toast.error('Bin, non-zero quantity, and reason are required.')
      return
    }

    try {
      await adjustMutation.mutateAsync({ locationId, quantity, reason })
      toast.success('Stock adjusted')
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to adjust stock'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Storage bin</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select bin" />
                </SelectTrigger>
                <SelectContent>
                  {binLocations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adjust-quantity">Signed quantity</Label>
              <Input
                id="adjust-quantity"
                name="quantity"
                type="number"
                step="0.001"
                required
              />
              <p className="text-xs text-muted-foreground">
                Use a negative value to remove stock. Resulting on-hand quantity cannot go below zero.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adjust-reason">Reason</Label>
              <Input id="adjust-reason" name="reason" required />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={adjustMutation.isPending}>
              Apply adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
