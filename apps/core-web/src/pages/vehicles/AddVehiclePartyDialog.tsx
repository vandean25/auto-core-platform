import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Customer } from '@/api/types'
import { useAddVehicleParty } from '@/api/vehicles'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getErrorMessage } from '@/lib/error-utils'
import { VEHICLE_PARTY_ROLES, formatVehiclePartyRole, type VehiclePartyRole } from './vehicle-party-model'

type AddVehiclePartyDialogProps = {
  vehicleId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddVehiclePartyDialog({ vehicleId, open, onOpenChange }: AddVehiclePartyDialogProps) {
  const { t } = useTranslation('vehicles')
  const addParty = useAddVehicleParty(vehicleId)
  const [role, setRole] = useState<VehiclePartyRole>('DRIVER')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [validFrom, setValidFrom] = useState('')
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setCustomer(null)
    setValidFrom('')
    setError(null)
    onOpenChange(false)
  }

  const save = async () => {
    if (!customer) {
      setError(t('parties.dialog.customerRequired'))
      return
    }
    setError(null)
    try {
      await addParty.mutateAsync({ customer_id: customer.id, role, valid_from: validFrom || null })
      toast.success(t('parties.added'))
      close()
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError, t('parties.addFailed')))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('parties.dialog.title')}</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='party-role'>{t('parties.dialog.role')}</Label>
            <Select value={role} onValueChange={(value) => setRole(value as VehiclePartyRole)}>
              <SelectTrigger id='party-role'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_PARTY_ROLES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {formatVehiclePartyRole(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <Label>{t('parties.dialog.customer')}</Label>
            <CustomerSearch value={customer} onChange={setCustomer} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='party-valid-from'>{t('parties.dialog.validFrom')}</Label>
            <Input
              id='party-valid-from'
              type='date'
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
            />
            <p className='text-xs text-muted-foreground'>{t('parties.dialog.validFromHint')}</p>
          </div>
          {error ? (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          ) : null}
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={close}>
              {t('parties.dialog.cancel')}
            </Button>
            <Button onClick={() => void save()} disabled={addParty.isPending}>
              {t('parties.dialog.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
