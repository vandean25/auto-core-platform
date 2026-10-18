import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
import { ensureNamespaceLoaded } from '@/lib/i18n'

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
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

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
      toast.error(t('dialogs.adjustStock.validationRequired'))
      return
    }

    try {
      await adjustMutation.mutateAsync({ locationId, quantity, reason })
      toast.success(t('dialogs.adjustStock.success'))
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('dialogs.adjustStock.failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('dialogs.adjustStock.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t('dialogs.adjustStock.storageBin')}</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('dialogs.adjustStock.selectBin')} />
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
              <Label htmlFor="adjust-quantity">{t('dialogs.adjustStock.signedQuantity')}</Label>
              <Input
                id="adjust-quantity"
                name="quantity"
                type="number"
                step="0.001"
                required
              />
              <p className="text-xs text-muted-foreground">
                {t('dialogs.adjustStock.signedQuantityHint')}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adjust-reason">{t('dialogs.adjustStock.reason')}</Label>
              <Input id="adjust-reason" name="reason" required />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={adjustMutation.isPending}>
              {t('actions.applyAdjustment')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
