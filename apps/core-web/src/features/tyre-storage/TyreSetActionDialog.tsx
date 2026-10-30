import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/api/generated/openapi'
import { useLocations, type StorageLocation } from '@/api/locations'
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
import { Checkbox } from '@/components/ui/checkbox'
import { TyreMeasurementForm } from '@/features/tyre-report/TyreMeasurementForm'
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

type ActionKind = 'check-in' | 'check-out' | 'move' | 'dispose' | 'inspect'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tyreSetId: string
  action: ActionKind
  currentLocationId?: string | null
  vehicleId?: string | null
  initialMeasurement?: components['schemas']['TyreMeasurementResponseDto']
}

type ActionTitleKey =
  | 'tyreStorage.actionDialog.checkIn'
  | 'tyreStorage.actionDialog.checkOut'
  | 'tyreStorage.actionDialog.move'
  | 'tyreStorage.actionDialog.dispose'
  | 'workshop:tyreReport.record'

const titleKeyByAction: Record<ActionKind, ActionTitleKey> = {
  'check-in': 'tyreStorage.actionDialog.checkIn',
  'check-out': 'tyreStorage.actionDialog.checkOut',
  move: 'tyreStorage.actionDialog.move',
  dispose: 'tyreStorage.actionDialog.dispose',
  inspect: 'workshop:tyreReport.record',
}

type HotelEventFields = {
  locationId: string
  odometer: string
  note: string
  workshopOrderId: string
}

type HotelEventFieldsProps = {
  fields: HotelEventFields
  onChange: (fields: HotelEventFields) => void
  requiresLocation: boolean
  storageLocations: StorageLocation[]
  disabled: boolean
}

function HotelEventFields({ fields, onChange, requiresLocation, storageLocations, disabled }: HotelEventFieldsProps) {
  const { t } = useTranslation('inventory')

  return (
    <>
      {requiresLocation ? (
        <div className="space-y-2">
          <Label htmlFor="tyre-action-location">{t('tyreStorage.actionDialog.location')}</Label>
          <Select value={fields.locationId} onValueChange={(locationId) => onChange({ ...fields, locationId })} disabled={disabled}>
            <SelectTrigger id="tyre-action-location" className="min-h-11">
              <SelectValue placeholder={t('tyreStorage.actionDialog.selectRack')} />
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
        <Label htmlFor="tyre-action-odometer">{t('tyreStorage.actionDialog.odometer')}</Label>
        <Input id="tyre-action-odometer" className="min-h-11" disabled={disabled} value={fields.odometer} onChange={(e) => onChange({ ...fields, odometer: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tyre-action-note">{t('tyreStorage.actionDialog.note')}</Label>
        <Input id="tyre-action-note" className="min-h-11" disabled={disabled} value={fields.note} onChange={(e) => onChange({ ...fields, note: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tyre-action-order">{t('tyreStorage.actionDialog.workshopOrderId')}</Label>
        <Input
          id="tyre-action-order"
          className="min-h-11"
          disabled={disabled}
          value={fields.workshopOrderId}
          onChange={(e) => onChange({ ...fields, workshopOrderId: e.target.value })}
        />
      </div>
    </>
  )
}

type TyreSetMeasurementContentProps = Pick<Props, 'action' | 'vehicleId' | 'initialMeasurement'> & {
  children: ReactNode
  isPending: boolean
  disabled: boolean
  onSave: (measurement?: components['schemas']['CreateTyreMeasurementDto']) => Promise<void>
  onSubmit: () => Promise<void>
}

function TyreSetMeasurementContent({
  action, vehicleId, initialMeasurement, children, isPending, disabled, onSave, onSubmit,
}: TyreSetMeasurementContentProps) {
  const { t } = useTranslation(['workshop', 'common'])
  const [includeMeasurement, setIncludeMeasurement] = useState(false)
  const supportsMeasurement = Boolean(vehicleId) &&
    (action === 'check-in' || action === 'check-out' || action === 'inspect')
  const showMeasurement = supportsMeasurement && includeMeasurement

  return (
    <>
      <div className="space-y-3">
        {children}
        {supportsMeasurement ? (
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox id="tyre-action-measurement" checked={includeMeasurement}
              disabled={isPending} onCheckedChange={(checked) => setIncludeMeasurement(checked === true)} />
            <Label htmlFor="tyre-action-measurement">{t('tyreReport.record')}</Label>
          </div>
        ) : null}
      </div>
      {showMeasurement ? (
        <>
          <p className="text-sm text-muted-foreground">{t('tyreReport.noHotelPhotos')}</p>
          <TyreMeasurementForm onSave={onSave} initial={initialMeasurement} disabled={disabled} />
        </>
      ) : (
        <DialogFooter>
          <Button className="min-h-11" onClick={() => void onSubmit()} disabled={disabled}>
            {t('common:actions.confirm')}
          </Button>
        </DialogFooter>
      )}
    </>
  )
}

export function TyreSetActionDialog({
  open,
  onOpenChange,
  tyreSetId,
  action,
  currentLocationId,
  vehicleId,
  initialMeasurement,
}: Props) {
  const { t } = useTranslation(['inventory', 'common', 'workshop'])
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const requiresLocation = action === 'check-in' || action === 'move'
  const { data: locations } = useLocations({ enabled: requiresLocation })
  const runAction = useTyreSetAction()
  const [eventFields, setEventFields] = useState<HotelEventFields>({
    locationId: '', odometer: '', note: '', workshopOrderId: '',
  })
  const { locationId, odometer, note, workshopOrderId } = eventFields
  const disabled = runAction.isPending || (requiresLocation && !locationId)

  const storageLocations = (locations ?? []).filter(
    (loc) => loc.type === 'customer_storage' && loc.id !== currentLocationId,
  )

  const save = async (measurement?: components['schemas']['CreateTyreMeasurementDto']) => {
    if (disabled) return
    const body: components['schemas']['TyreSetLocationActionDto'] = {
      locationId: requiresLocation ? locationId : undefined,
      odometer: odometer ? Number(odometer) : undefined,
      note: note || undefined,
      workshopOrderId: workshopOrderId || undefined,
      ...(measurement ? { wheels: measurement.wheels, weightClass: measurement.weightClass } : {}),
    }
    await runAction.mutateAsync({ id: tyreSetId, action, body })
    toast.success(t('inventory:tyreStorage.actionDialog.success'))
    onOpenChange(false)
  }

  const submit = async () => {
    try {
      await save()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('inventory:tyreStorage.actionDialog.failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t(titleKeyByAction[action])}</DialogTitle>
        </DialogHeader>
        <TyreSetMeasurementContent
          action={action}
          vehicleId={vehicleId}
          initialMeasurement={initialMeasurement}
          isPending={runAction.isPending}
          disabled={disabled}
          onSave={save}
          onSubmit={submit}
        >
          <HotelEventFields
            fields={eventFields}
            onChange={setEventFields}
            requiresLocation={requiresLocation}
            storageLocations={storageLocations}
            disabled={runAction.isPending}
          />
        </TyreSetMeasurementContent>
      </DialogContent>
    </Dialog>
  )
}
