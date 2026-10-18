import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { ensureNamespaceLoaded } from '@/lib/i18n'

type ActionKind = 'check-in' | 'check-out' | 'move' | 'dispose'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tyreSetId: string
  action: ActionKind
  currentLocationId?: string | null
}

type ActionTitleKey =
  | 'tyreStorage.actionDialog.checkIn'
  | 'tyreStorage.actionDialog.checkOut'
  | 'tyreStorage.actionDialog.move'
  | 'tyreStorage.actionDialog.dispose'

const titleKeyByAction: Record<ActionKind, ActionTitleKey> = {
  'check-in': 'tyreStorage.actionDialog.checkIn',
  'check-out': 'tyreStorage.actionDialog.checkOut',
  move: 'tyreStorage.actionDialog.move',
  dispose: 'tyreStorage.actionDialog.dispose',
}

export function TyreSetActionDialog({
  open,
  onOpenChange,
  tyreSetId,
  action,
  currentLocationId,
}: Props) {
  const { t } = useTranslation(['inventory', 'common'])
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

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
      toast.success(t('inventory:tyreStorage.actionDialog.success'))
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('inventory:tyreStorage.actionDialog.failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(titleKeyByAction[action])}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {action !== 'check-out' && action !== 'dispose' ? (
            <div className="space-y-2">
              <Label>{t('inventory:tyreStorage.actionDialog.location')}</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="min-h-11">
                  <SelectValue placeholder={t('inventory:tyreStorage.actionDialog.selectRack')} />
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
            <Label>{t('inventory:tyreStorage.actionDialog.odometer')}</Label>
            <Input className="min-h-11" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('inventory:tyreStorage.actionDialog.note')}</Label>
            <Input className="min-h-11" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('inventory:tyreStorage.actionDialog.workshopOrderId')}</Label>
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
            {t('common:actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
