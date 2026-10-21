import { useTranslation } from 'react-i18next'
import type { Customer } from '@/api/types'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type ChangeCustomerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: Customer | null
  onSelect: (customer: Customer | null) => void
  onSave: () => Promise<void>
}

export function ChangeCustomerDialog({
  open,
  onOpenChange,
  selected,
  onSelect,
  onSave,
}: ChangeCustomerDialogProps) {
  const { t } = useTranslation('vehicles')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('detail.changeCustomerDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <CustomerSearch value={selected} onChange={(customerValue) => onSelect(customerValue)} />
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => onSelect(null)} disabled={!selected}>
              {t('detail.changeCustomerDialog.unassign')}
            </Button>
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              {t('detail.changeCustomerDialog.cancel')}
            </Button>
            <Button onClick={() => void onSave()}>{t('detail.changeCustomerDialog.save')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
