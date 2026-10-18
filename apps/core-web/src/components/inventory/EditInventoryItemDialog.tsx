import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { InventoryItemDetail } from '@/api/inventory'
import { useUpdateInventoryItem } from '@/api/inventory'
import { BrandCombobox } from '@/components/BrandCombobox'
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
import { getErrorMessage } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'

type EditInventoryItemDialogProps = {
  item: InventoryItemDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditInventoryItemDialog({ item, open, onOpenChange }: EditInventoryItemDialogProps) {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const updateMutation = useUpdateInventoryItem(item.id)
  const [brandId, setBrandId] = React.useState<number | undefined>(item.brand_id ?? undefined)

  React.useEffect(() => {
    if (open) {
      setBrandId(item.brand_id ?? undefined)
    }
  }, [item.brand_id, open])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    try {
      await updateMutation.mutateAsync({
        sku: String(formData.get('sku')),
        name: String(formData.get('name')),
        cost_price: Number(formData.get('cost_price')),
        retail_price: Number(formData.get('retail_price')),
        brandId,
      })
      toast.success(t('dialogs.editItem.success'))
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('dialogs.editItem.failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('dialogs.editItem.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-sku">{t('dialogs.editItem.sku')}</Label>
                <Input id="edit-sku" name="sku" defaultValue={item.sku} required />
              </div>
              <div className="grid gap-2">
                <Label>{t('dialogs.editItem.brand')}</Label>
                <BrandCombobox value={brandId} onChange={setBrandId} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-name">{t('dialogs.editItem.name')}</Label>
              <Input id="edit-name" name="name" defaultValue={item.name} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-cost">{t('dialogs.editItem.costPrice')}</Label>
                <Input
                  id="edit-cost"
                  name="cost_price"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={item.cost_price}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-retail">{t('dialogs.editItem.retailPrice')}</Label>
                <Input
                  id="edit-retail"
                  name="retail_price"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={item.price}
                  required
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateMutation.isPending}>
              {t('actions.saveChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
