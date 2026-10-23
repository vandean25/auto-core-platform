import { useCustomer } from '@/api/customers'
import { useVehicle } from '@/api/vehicles'
import { useWorkshopOrder } from '@/api/workshop'
import type { GlobalSearchRecordRef } from './global-search-record-route'

export function useGlobalSearchRecordData(recordRef: GlobalSearchRecordRef | null, enabled: boolean) {
  const workshopOrderId =
    enabled && recordRef?.entity === 'workshop_order' ? recordRef.id : ''
  const customerId = enabled && recordRef?.entity === 'customer' ? recordRef.id : ''
  const vehicleId = enabled && recordRef?.entity === 'vehicle' ? recordRef.id : ''

  const workshopOrderQuery = useWorkshopOrder(workshopOrderId)
  const customerQuery = useCustomer(customerId)
  const vehicleQuery = useVehicle(vehicleId)

  const isLoadingContext =
    (recordRef?.entity === 'workshop_order' && workshopOrderQuery.isLoading) ||
    (recordRef?.entity === 'customer' && customerQuery.isLoading) ||
    (recordRef?.entity === 'vehicle' && vehicleQuery.isLoading)

  return {
    order: workshopOrderQuery.data,
    customer: customerQuery.data,
    vehicle: vehicleQuery.data,
    isLoadingContext: enabled && isLoadingContext,
  }
}
