import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { ensureNamespaceLoaded } from '@/lib/i18n'

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
  const { t } = useTranslation(['inventory', 'common'])
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

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
        const body: Record<string, unknown> = { label, season }
        if (binLabel !== (existing.binLabel ?? '')) {
          body.binLabel = binLabel || null
        }
        if (dimension !== (existing.dimension ?? '')) {
          body.dimension = dimension || null
        }
        await updateTyreSet.mutateAsync({
          id: existing.id,
          body: body as components['schemas']['UpdateTyreSetDto'],
        })
      } else {
        await createTyreSet.mutateAsync(body)
      }
      toast.success(t('inventory:tyreStorage.form.success'))
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('inventory:tyreStorage.form.failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing ? t('inventory:tyreStorage.form.editTitle') : t('inventory:tyreStorage.form.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t('inventory:tyreStorage.form.label')}</Label>
            <Input className="min-h-11" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('inventory:tyreStorage.form.season')}</Label>
            <Select value={season} onValueChange={(v) => setSeason(v as typeof season)}>
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WINTER">{t('inventory:tyreStorage.list.filters.winter')}</SelectItem>
                <SelectItem value="SUMMER">{t('inventory:tyreStorage.list.filters.summer')}</SelectItem>
                <SelectItem value="ALL_SEASON">{t('inventory:tyreStorage.list.filters.allSeason')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!existing ? (
            <div className="space-y-2">
              <Label>{t('inventory:tyreStorage.form.storageLocation')}</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="min-h-11">
                  <SelectValue placeholder={t('inventory:tyreStorage.form.optionalOnCreate')} />
                </SelectTrigger>
                <SelectContent>
                  {storageLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {t('inventory:shared.locationCodeName', { code: loc.code, name: loc.name })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>{t('inventory:tyreStorage.form.binLabel')}</Label>
            <Input className="min-h-11" value={binLabel} onChange={(e) => setBinLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('inventory:tyreStorage.form.dimension')}</Label>
            <Input
              className="min-h-11"
              placeholder={t('inventory:tyreStorage.form.dimensionPlaceholder')}
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button className="min-h-11" onClick={() => void submit()} disabled={!label.trim()}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
