import { useState } from 'react'
import type { components } from '@/api/generated/openapi'
import { useLocations } from '@/api/locations'
import { useTyreSetAction } from '@/api/tyre-storage'
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
import { toast } from 'sonner'

type ActionKind = 'check-in' | 'check-out' | 'move' | 'dispose'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tyreSetId: string
  action: ActionKind
  currentLocationId?: string | null
}

export function TyreSetActionDialog({
  open,
  onOpenChange,
  tyreSetId,
  action,
  currentLocationId,
}: Props) {
  const { data: locations } = useLocations()
  const runAction = useTyreSetAction()
  const [locationId, setLocationId] = useState('')
  const [odometer, setOdometer] = useState('')
  const [note, setNote] = useState('')
  const [workshopOrderId, setWorkshopOrderId] = useState('')

  const storageLocations = (locations ?? []).filter(
    (loc) => loc.type === 'customer_storage' && loc.id !== currentLocationId,
  )

  const submit = async () => {
    const body: components['schemas']['TyreSetLocationActionDto'] = {
      locationId: action === 'check-out' || action === 'dispose' ? undefined : locationId,
      odometer: odometer ? Number(odometer) : undefined,
      note: note || undefined,
      workshopOrderId: workshopOrderId || undefined,
    }
    try {
      await runAction.mutateAsync({ id: tyreSetId, action, body })
      toast.success('Updated')
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Action failed'))
    }
  }

  const title =
    action === 'check-in'
      ? 'Check in'
      : action === 'check-out'
        ? 'Check out'
        : action === 'move'
          ? 'Move'
          : 'Dispose'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {action !== 'check-out' && action !== 'dispose' ? (
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="min-h-11">
                  <SelectValue placeholder="Select rack" />
                </SelectTrigger>
                <SelectContent>
                  {storageLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Odometer</Label>
            <Input className="min-h-11" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Note</Label>
            <Input className="min-h-11" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Workshop order id</Label>
            <Input
              className="min-h-11"
              value={workshopOrderId}
              onChange={(e) => setWorkshopOrderId(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="min-h-11"
            onClick={() => void submit()}
            disabled={
              (action === 'check-in' || action === 'move') && !locationId
            }
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
