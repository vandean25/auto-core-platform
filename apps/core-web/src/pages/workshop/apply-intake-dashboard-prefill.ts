import type { Vehicle } from '@/api/types'
import type { CustomerDetailResponse } from '@/pages/customers/customer-detail-model'
import { getCustomerDisplayName } from '@/pages/customers/customer-detail-model'
import type { WorkshopIntakePrefill } from '@/components/global-search/workshop-intake-prefill'
import type { IntakeSelectedVehicle } from './use-intake-dashboard-prefill'

export type ApplyIntakeDashboardPrefillResult = 'applied' | 'skipped' | 'pending'

export function applyIntakeDashboardPrefill({
  prefill,
  vehicle,
  customer,
  search,
  selectedVehicle,
  setSearch,
  setSelectedVehicle,
}: {
  prefill: WorkshopIntakePrefill
  vehicle: Vehicle | undefined
  customer: CustomerDetailResponse | undefined
  search: string
  selectedVehicle: IntakeSelectedVehicle | null
  setSearch: (value: string) => void
  setSelectedVehicle: (value: IntakeSelectedVehicle | null) => void
}): ApplyIntakeDashboardPrefillResult {
  if (!prefill.vehicleId && !prefill.customerId) return 'pending'

  if (search.trim() || selectedVehicle) {
    return 'skipped'
  }

  if (prefill.vehicleId && vehicle) {
    const customerId = vehicle.customer?.id
    if (!customerId) return 'pending'
    setSelectedVehicle({
      id: vehicle.id,
      description: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      customerId,
    })
    return 'applied'
  }

  if (!prefill.vehicleId && prefill.customerId && customer) {
    const vehicles = customer.vehicles ?? []
    if (vehicles.length === 1) {
      const onlyVehicle = vehicles[0]
      setSelectedVehicle({
        id: onlyVehicle.id,
        description: `${onlyVehicle.make} ${onlyVehicle.model}`,
        customerId: customer.id,
      })
      return 'applied'
    }

    const label = getCustomerDisplayName(customer)
    if (label) setSearch(label)
    return 'applied'
  }

  return 'pending'
}
