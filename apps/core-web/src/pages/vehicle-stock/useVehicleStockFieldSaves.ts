import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { usePatchVehicleStock, type PatchVehicleStockInput } from '@/api/vehicle-stock'
import type { VehicleRegulatoryValues } from '@/components/vehicles/VehicleRegulatorySection'
import { isVehicleStockPatchOptimisticEligible } from '@/features/interaction/customer-vehicle-update-eligibility'
import { useOptimisticFieldSave } from '@/features/interaction/use-optimistic-field-save'
import { getErrorMessage } from '@/lib/error-utils'

export type StockDescriptiveField = 'mileage' | 'color' | 'key_number' | 'registration_certificate_no'

function toStockPatch(field: StockDescriptiveField, value: string): PatchVehicleStockInput {
  return field === 'mileage' ? { mileage: Number(value) || 0 } : { [field]: value }
}

/**
 * Saves of the stock detail. Descriptive fields are optimistic with an error marker; regulatory fields and the
 * reservation wait for the server, and the reservation picker shows the pending state (ADR-0036 R1).
 */
export function useVehicleStockFieldSaves(vehicleId: string) {
  const { t } = useTranslation('vehicleStock')
  const patchStock = usePatchVehicleStock(vehicleId)
  const [reserving, setReserving] = useState(false)
  const descriptiveSave = useOptimisticFieldSave<StockDescriptiveField, string>({
    save: (field, value) => patchStock.mutateAsync(toStockPatch(field, value)),
    isOptimistic: (field, value) => isVehicleStockPatchOptimisticEligible(toStockPatch(field, value)),
    successMessage: t('shared.saved'),
    failureMessage: t('stockDetail.saveFailed'),
  })

  const saveServerConfirmed = async (patch: PatchVehicleStockInput) => {
    try {
      await patchStock.mutateAsync(patch)
      toast.success(t('shared.saved'))
    } catch (error) {
      toast.error(getErrorMessage(error, t('stockDetail.saveFailed')))
    }
  }
  const reserve = async (customerId: string | null) => {
    setReserving(true)
    try {
      await saveServerConfirmed({ reserved_for_customer_id: customerId })
    } finally {
      setReserving(false)
    }
  }
  const saveRegulatory = (patch: Partial<VehicleRegulatoryValues>) =>
    saveServerConfirmed(patch as PatchVehicleStockInput)

  return { descriptiveSave, reserving, reserve, saveRegulatory }
}
