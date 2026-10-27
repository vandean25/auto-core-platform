import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('workshop')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('mechanic.taskDetail.requestPart.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div>
            <Label htmlFor="part-item-no">{t('mechanic.taskDetail.requestPart.itemNo')}</Label>
            <Input
              id="part-item-no"
              value={partForm.itemNo}
              onChange={(event) => onFormChange({ itemNo: event.target.value })}
              placeholder={t('mechanic.taskDetail.requestPart.itemNoPlaceholder')}
              className="mt-1 min-h-[44px]"
            />
          </div>
          <div>
            <Label htmlFor="part-description">{t('mechanic.taskDetail.requestPart.description')}</Label>
            <Input
              id="part-description"
              value={partForm.description}
              onChange={(event) => onFormChange({ description: event.target.value })}
              placeholder={t('mechanic.taskDetail.requestPart.descriptionPlaceholder')}
              className="mt-1 min-h-[44px]"
            />
          </div>
          <div>
            <Label htmlFor="part-qty">{t('mechanic.taskDetail.requestPart.quantity')}</Label>
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
            <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button className="min-h-11" onClick={onSubmit} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {t('mechanic.taskDetail.requestPart.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
