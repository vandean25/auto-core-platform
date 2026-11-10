import { useCustomer } from '@/api/customers'
import { useSalesOrder } from '@/api/sales-orders'
import { useTyreSet } from '@/api/tyre-storage'
import { useCreditNote } from '@/api/useCreditNotes'
import { useVehicle } from '@/api/vehicles'
import { useWorkshopOrder } from '@/api/workshop'
import { useWorkshopEstimateVersion } from '@/api/workshop-estimates'
import type { GlobalSearchRecordRef } from './global-search-record-route'

/** The id of the record when the palette is open on a record of that entity, else an empty id (no fetch). */
function idOfEntity(recordRef: GlobalSearchRecordRef | null, entity: GlobalSearchRecordRef['entity'], enabled: boolean) {
  return enabled && recordRef?.entity === entity ? recordRef.id : ''
}

export function useGlobalSearchRecordData(recordRef: GlobalSearchRecordRef | null, enabled: boolean) {
  const workshopOrderQuery = useWorkshopOrder(idOfEntity(recordRef, 'workshop_order', enabled))
  const customerQuery = useCustomer(idOfEntity(recordRef, 'customer', enabled))
  const vehicleQuery = useVehicle(idOfEntity(recordRef, 'vehicle', enabled))
  const estimateQuery = useWorkshopEstimateVersion(idOfEntity(recordRef, 'estimate', enabled) || null)
  const tyreSetQuery = useTyreSet(idOfEntity(recordRef, 'tyre_set', enabled))
  const creditNoteQuery = useCreditNote(idOfEntity(recordRef, 'credit_note', enabled))
  const salesOrderQuery = useSalesOrder(idOfEntity(recordRef, 'sales_order', enabled))

  const loadingByEntity: Record<GlobalSearchRecordRef['entity'], boolean> = {
    workshop_order: workshopOrderQuery.isLoading,
    customer: customerQuery.isLoading,
    vehicle: vehicleQuery.isLoading,
    estimate: estimateQuery.isLoading,
    tyre_set: tyreSetQuery.isLoading,
    credit_note: creditNoteQuery.isLoading,
    sales_order: salesOrderQuery.isLoading,
  }

  return {
    order: workshopOrderQuery.data,
    customer: customerQuery.data,
    vehicle: vehicleQuery.data,
    estimate: estimateQuery.data,
    tyreSet: tyreSetQuery.data,
    creditNote: creditNoteQuery.data,
    salesOrder: salesOrderQuery.data,
    isLoadingContext: enabled && Boolean(recordRef && loadingByEntity[recordRef.entity]),
  }
}
