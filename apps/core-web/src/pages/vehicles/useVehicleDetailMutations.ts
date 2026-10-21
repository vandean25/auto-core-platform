import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUpdateVehicle } from '@/api/vehicles'
import type { Customer } from '@/api/types'
import { getErrorMessage } from '@/lib/error-utils'
import type { VehicleRegulatoryValues } from '@/components/vehicles/VehicleRegulatorySection'
import type { VehicleDetailResponse } from './vehicle-detail-model'

export type EditableVehicleField = 'make' | 'model' | 'year' | 'engine_code' | 'vin' | 'plate'

/** Inline field saves of the vehicle card: toast on success, toast and rethrow on failure. */
export function useVehicleFieldSaves(vehicleId: string) {
  const { t } = useTranslation('vehicles')
  const updateVehicle = useUpdateVehicle()

  const savePatch = async (data: Partial<VehicleRegulatoryValues> | Record<string, string | number>) => {
    try {
      await updateVehicle.mutateAsync({ id: vehicleId, data })
      toast.success(t('detail.updated'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('detail.updateFailed')))
      throw error
    }
  }

  const saveVehicleField = async (field: EditableVehicleField, nextValue: string) => {
    if (field !== 'year') {
      return savePatch({ [field]: nextValue })
    }
    const parsedYear = Number(nextValue)
    if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
      toast.error(t('detail.invalidYear'))
      throw new Error('Invalid year')
    }
    return savePatch({ year: parsedYear })
  }

  return { saveRegulatoryField: savePatch, saveVehicleField }
}

/** State and save flow of the "change customer" dialog; closes only on success or when nothing changed. */
export function useChangeCustomer(vehicle: VehicleDetailResponse) {
  const { t } = useTranslation('vehicles')
  const updateVehicle = useUpdateVehicle()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)

  const openDialog = () => {
    setSelected(vehicle.customer ?? null)
    setOpen(true)
  }

  const save = async () => {
    if ((selected?.id ?? null) === (vehicle.customer?.id ?? null)) {
      setOpen(false)
      return
    }

    try {
      await updateVehicle.mutateAsync({
        id: vehicle.id,
        data: { customer_id: selected?.id ?? null },
      })
      toast.success(t('detail.customerUpdated'))
      setOpen(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('detail.customerUpdateFailed')))
    }
  }

  return { openDialog, dialogProps: { open, onOpenChange: setOpen, selected, onSelect: setSelected, onSave: save } }
}
