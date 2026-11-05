import type { WorkshopOrder } from '@/api/types'
import type { DataTablePendingRowMeta } from '@/components/data-table/data-table-states'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'
import { generateId } from '@/lib/id'

type ExistingVehicle = {
  id: string
  year: number | string
  make: string
  model: string
  customer: WorkshopOrder['customer']
}

export type WorkshopOrderListPendingRow = WorkshopOrderListRow & DataTablePendingRowMeta

type CreateOrderPayload = {
  customerId: string
  vehicleId: string
  odometer: number
  fuelLevel: number
  reportedIssue?: string
  createPickerlTask?: boolean
}

type CreateOrderFn = (payload: CreateOrderPayload) => Promise<{ id: string }>

export function buildWorkshopOrderPendingListRow(
  localId: string,
  vehicle: ExistingVehicle,
): WorkshopOrderListPendingRow {
  return {
    id: localId,
    __dataTablePending: true,
    orderNo: '',
    customer: getWorkshopCustomerDisplayName({ customer: vehicle.customer } as WorkshopOrder),
    vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    openedAt: '',
    status: 'SCHEDULED',
  }
}

type PendingCallbacks = {
  listPendingMode: boolean
  onPendingOrder?: (row: WorkshopOrderListPendingRow, meta: { localId: string }) => void
  onPendingOrderSettled?: (localId: string, serverOrderId: string) => void
  closeDialog: () => void
}

export function startPendingWorkshopOrder(
  vehicle: ExistingVehicle,
  callbacks: PendingCallbacks,
): string | undefined {
  if (!callbacks.listPendingMode || !callbacks.onPendingOrder) return undefined
  const localId = generateId()
  callbacks.onPendingOrder(buildWorkshopOrderPendingListRow(localId, vehicle), { localId })
  callbacks.closeDialog()
  return localId
}

export function finishPendingWorkshopOrder(
  pendingLocalId: string | undefined,
  orderId: string,
  message: string,
  callbacks: PendingCallbacks & {
    toastSuccess: (message: string) => void
    onNavigateCreated: (orderId: string, message: string) => void
  },
): void {
  if (pendingLocalId && callbacks.onPendingOrderSettled) {
    callbacks.onPendingOrderSettled(pendingLocalId, orderId)
    callbacks.toastSuccess(message)
    return
  }
  callbacks.onNavigateCreated(orderId, message)
}

export async function createWorkshopOrderFromVehicle(
  vehicle: ExistingVehicle,
  payload: Omit<CreateOrderPayload, 'customerId' | 'vehicleId'>,
  createOrder: CreateOrderFn,
  pendingCallbacks: PendingCallbacks,
  successMessage: string,
  notify: {
    toastSuccess: (message: string) => void
    onNavigateCreated: (orderId: string, message: string) => void
  },
): Promise<string | undefined> {
  if (!vehicle.customer?.id) {
    throw new Error('missing-customer')
  }
  const pendingLocalId = startPendingWorkshopOrder(vehicle, pendingCallbacks)
  const order = await createOrder({
    customerId: vehicle.customer.id,
    vehicleId: vehicle.id,
    ...payload,
  })
  finishPendingWorkshopOrder(pendingLocalId, order.id, successMessage, { ...pendingCallbacks, ...notify })
  return pendingLocalId
}
