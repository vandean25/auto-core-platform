import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useReceiveInventoryStock } from '@/api/inventory'
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

type ReceiveInventoryStockDialogProps = {
  itemId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReceiveInventoryStockDialog({
  itemId,
  open,
  onOpenChange,
}: ReceiveInventoryStockDialogProps) {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const receiveMutation = useReceiveInventoryStock(itemId)
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
    if (!locationId || Number.isNaN(quantity) || quantity <= 0) {
      toast.error(t('dialogs.receiveStock.validationRequired'))
      return
    }

    try {
      await receiveMutation.mutateAsync({ locationId, quantity })
      toast.success(t('dialogs.receiveStock.success'))
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('dialogs.receiveStock.failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('dialogs.receiveStock.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t('dialogs.receiveStock.storageBin')}</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('dialogs.receiveStock.selectBin')} />
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
              <Label htmlFor="receive-quantity">{t('dialogs.receiveStock.quantity')}</Label>
              <Input
                id="receive-quantity"
                name="quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={receiveMutation.isPending}>
              {t('dialogs.receiveStock.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
