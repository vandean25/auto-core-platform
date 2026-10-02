import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { components } from '@/api/generated/openapi'
import { useLocations } from '@/api/locations'
import { useCreateTyreSet, useUpdateTyreSet, type TyreSet } from '@/api/tyre-storage'
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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerId: string
  vehicleId?: string | null
  existing?: TyreSet | null
}

export function TyreSetFormDialog({
  open,
  onOpenChange,
  customerId,
  vehicleId,
  existing,
}: Props) {
  const { data: locations } = useLocations()
  const createTyreSet = useCreateTyreSet()
  const updateTyreSet = useUpdateTyreSet()
  const [label, setLabel] = useState('')
  const [season, setSeason] = useState<components['schemas']['TyreSeason']>('WINTER')
  const [locationId, setLocationId] = useState<string>('')
  const [binLabel, setBinLabel] = useState('')
  const [dimension, setDimension] = useState('')

  useEffect(() => {
    if (!open) return
    setLabel(existing?.label ?? '')
    setSeason(existing?.season ?? 'WINTER')
    setLocationId(existing?.locationId ?? '')
    setBinLabel(existing?.binLabel ?? '')
    setDimension(existing?.dimension ?? '')
  }, [open, existing])

  const storageLocations = (locations ?? []).filter(
    (loc) => loc.type === 'customer_storage',
  )

  const submit = async () => {
    const body: components['schemas']['CreateTyreSetDto'] = {
      customerId,
      vehicleId: vehicleId ?? undefined,
      label,
      season,
      tyreCount: 4,
      locationId: locationId || undefined,
      binLabel: binLabel || undefined,
      dimension: dimension || undefined,
    }
    try {
      if (existing) {
        await updateTyreSet.mutateAsync({
          id: existing.id,
          body: {
            label,
            season,
            ...(binLabel ? { binLabel } : {}),
            ...(dimension ? { dimension } : {}),
          } as components['schemas']['UpdateTyreSetDto'],
        })
      } else {
        await createTyreSet.mutateAsync(body)
      }
      toast.success('Tyre set saved')
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to save tyre set'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit tyre set' : '+ Tyre set'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Label</Label>
            <Input className="min-h-11" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Season</Label>
            <Select value={season} onValueChange={(v) => setSeason(v as typeof season)}>
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WINTER">Winter</SelectItem>
                <SelectItem value="SUMMER">Summer</SelectItem>
                <SelectItem value="ALL_SEASON">All season</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Storage location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Optional on create" />
              </SelectTrigger>
              <SelectContent>
                {storageLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.code} — {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Bin label</Label>
            <Input className="min-h-11" value={binLabel} onChange={(e) => setBinLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Dimension</Label>
            <Input
              className="min-h-11"
              placeholder="245/45 R18"
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button className="min-h-11" onClick={() => void submit()} disabled={!label.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
