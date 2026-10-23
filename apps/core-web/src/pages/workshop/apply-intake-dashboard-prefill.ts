import type { Vehicle } from '@/api/types'
import type { CustomerDetailResponse } from '@/pages/customers/customer-detail-model'
import { getCustomerDisplayName } from '@/pages/customers/customer-detail-model'
import type { WorkshopIntakePrefill } from '@/components/global-search/workshop-intake-prefill'
import type { IntakeSelectedVehicle } from './use-intake-dashboard-prefill'

export function applyIntakeDashboardPrefill({
  prefill,
  vehicle,
  customer,
  search,
  setSearch,
  setSelectedVehicle,
}: {
  prefill: WorkshopIntakePrefill
  vehicle: Vehicle | undefined
  customer: CustomerDetailResponse | undefined
  search: string
  setSearch: (value: string) => void
  setSelectedVehicle: (value: IntakeSelectedVehicle | null) => void
}): boolean {
  if (prefill.vehicleId && vehicle) {
    const customerId = vehicle.customer?.id
    if (!customerId) return false
    setSelectedVehicle({
      id: vehicle.id,
      description: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      customerId,
    })
    return true
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
      return true
    }

    if (search.trim().length === 0) {
      const label = getCustomerDisplayName(customer)
      if (label) setSearch(label)
      return true
    }
  }

  return false
}
