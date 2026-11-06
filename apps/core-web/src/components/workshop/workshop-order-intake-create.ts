import type { WorkshopOrder } from '@/api/types'
import type { DataTablePendingRowMeta } from '@/components/data-table/data-table-states'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import {
  buildRegisterPayload,
  conflictFromError,
  type ExistingOrderConflict,
  type NewCustomerForm,
  type NewVehicleForm,
} from '@/features/workshop/intake-form'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'
import { getErrorMessage } from '@/lib/error-utils'
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

export type IntakeCreateMessages = {
  selectVehicle: string
  selectCustomer: string
  noCustomerLinked: string
  pickerlOpened: string
  orderCreated: string
  createFailed: string
}

type IntakeCreateDeps = {
  activeTab: 'existing' | 'new-vehicle' | 'registration-document'
  selectedVehicle: ExistingVehicle | null
  selectedCustomer: { id: string } | null
  customerMode: 'existing' | 'new'
  newVehicle: NewVehicleForm
  newCustomer: NewCustomerForm
  orderPayload: Omit<CreateOrderPayload, 'customerId' | 'vehicleId'>
  pickerlMode: boolean
  isCurrentAttempt: () => boolean
  formSignature: string
  messages: IntakeCreateMessages
  registerVehicle: (payload: ReturnType<typeof buildRegisterPayload>) => Promise<ExistingVehicle>
  createOrder: CreateOrderFn
  pendingCallbacks: PendingCallbacks
  notify: {
    toastSuccess: (message: string) => void
    onNavigateCreated: (orderId: string, message: string) => void
    toastError: (message: string) => void
    onConflict: (conflict: ExistingOrderConflict) => void
    onPendingFailed: (localId: string) => void
  }
}

export async function submitWorkshopIntakeOrder(deps: IntakeCreateDeps): Promise<void> {
  const vehicle = await resolveIntakeVehicle(deps)
  if (!vehicle) return
  await createResolvedIntakeOrder(vehicle, deps)
}

async function resolveIntakeVehicle(deps: IntakeCreateDeps): Promise<ExistingVehicle | undefined> {
  if (deps.activeTab === 'existing') return existingVehicleForIntake(deps)
  return registeredVehicleForIntake(deps)
}

function existingVehicleForIntake(deps: IntakeCreateDeps): ExistingVehicle | undefined {
  if (!deps.selectedVehicle?.customer?.id) {
    deps.notify.toastError(deps.messages.selectVehicle)
    return undefined
  }
  return deps.selectedVehicle
}

async function registeredVehicleForIntake(deps: IntakeCreateDeps): Promise<ExistingVehicle | undefined> {
  if (deps.customerMode === 'existing' && !deps.selectedCustomer?.id) {
    deps.notify.toastError(deps.messages.selectCustomer)
    return undefined
  }
  const vehicle = await deps.registerVehicle(
    buildRegisterPayload(deps.newVehicle, deps.newCustomer, deps.customerMode, deps.selectedCustomer?.id),
  )
  if (!vehicle.customer?.id) {
    deps.notify.toastError(deps.messages.noCustomerLinked)
    return undefined
  }
  return vehicle
}

async function createResolvedIntakeOrder(vehicle: ExistingVehicle, deps: IntakeCreateDeps): Promise<void> {
  let pendingLocalId: string | undefined
  try {
    pendingLocalId = await createWorkshopOrderFromVehicle(
      vehicle,
      deps.activeTab === 'existing' && deps.pickerlMode
        ? { ...deps.orderPayload, createPickerlTask: true }
        : deps.orderPayload,
      deps.createOrder,
      deps.pendingCallbacks,
      deps.pickerlMode && deps.activeTab === 'existing' ? deps.messages.pickerlOpened : deps.messages.orderCreated,
      deps.notify,
    )
  } catch (error) {
    if (pendingLocalId) deps.notify.onPendingFailed(pendingLocalId)
    const conflict = conflictFromError(error, {
      vehicleId: vehicle.id,
      tab: deps.activeTab,
      formSignature: deps.formSignature,
    })
    if (conflict && deps.isCurrentAttempt()) {
      deps.notify.onConflict(conflict)
      return
    }
    deps.notify.toastError(getErrorMessage(error, deps.messages.createFailed))
  }
}
