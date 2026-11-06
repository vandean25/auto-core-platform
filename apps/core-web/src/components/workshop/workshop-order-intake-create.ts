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

/** Why a list-pending create failed. `conflict` keeps the live order of a VEHICLE_HAS_ACTIVE_ORDER 409 reachable. */
export type PendingOrderFailure = {
  message: string
  conflict?: { orderId: string; orderNumber?: string }
}

export type WorkshopOrderListPendingRow = WorkshopOrderListRow & DataTablePendingRowMeta & {
  /** The submitted payload, so Retry re-sends exactly this create on the same row. */
  createPayload: CreateOrderPayload
  pendingFailure?: PendingOrderFailure
}

export type CreateOrderPayload = {
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
  createPayload: CreateOrderPayload,
): WorkshopOrderListPendingRow {
  return {
    id: localId,
    __dataTablePending: true,
    createPayload,
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
  payload: CreateOrderPayload,
  callbacks: PendingCallbacks,
): string | undefined {
  if (!callbacks.listPendingMode || !callbacks.onPendingOrder) return undefined
  const localId = generateId()
  callbacks.onPendingOrder(buildWorkshopOrderPendingListRow(localId, vehicle, payload), { localId })
  callbacks.closeDialog()
  return localId
}

/**
 * Runs (or re-runs) the create behind a pending row. The row stays until the orders refetch that
 * `useCreateWorkshopOrder` triggers, so a failure only marks it and a retry reuses the same row id.
 */
export async function createPendingWorkshopOrder(
  localId: string,
  payload: CreateOrderPayload,
  createOrder: CreateOrderFn,
  outcome: {
    createFailedMessage: string
    onSettled: (localId: string, serverOrderId: string) => void
    onFailed: (localId: string, failure: PendingOrderFailure) => void
  },
): Promise<void> {
  try {
    const order = await createOrder(payload)
    outcome.onSettled(localId, order.id)
  } catch (error) {
    outcome.onFailed(localId, pendingOrderFailureFromError(error, payload.vehicleId, outcome.createFailedMessage))
  }
}

function pendingOrderFailureFromError(error: unknown, vehicleId: string, fallback: string): PendingOrderFailure {
  const conflict = conflictFromError(error, { vehicleId, tab: 'existing', formSignature: '' })
  if (conflict) {
    return { message: conflict.message, conflict: { orderId: conflict.orderId, orderNumber: conflict.orderNumber } }
  }
  return { message: getErrorMessage(error, fallback) }
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
    onPendingFailed: (localId: string, failure: PendingOrderFailure) => void
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
  const payload: CreateOrderPayload = {
    customerId: vehicle.customer?.id ?? '',
    vehicleId: vehicle.id,
    ...(deps.activeTab === 'existing' && deps.pickerlMode
      ? { ...deps.orderPayload, createPickerlTask: true }
      : deps.orderPayload),
  }
  const successMessage =
    deps.pickerlMode && deps.activeTab === 'existing' ? deps.messages.pickerlOpened : deps.messages.orderCreated
  const pendingLocalId = startPendingWorkshopOrder(vehicle, payload, deps.pendingCallbacks)
  if (pendingLocalId) {
    // List create stays on the list; the pending row remains until the orders refetch includes the order.
    await createPendingWorkshopOrder(pendingLocalId, payload, deps.createOrder, {
      createFailedMessage: deps.messages.createFailed,
      onSettled: (localId, serverOrderId) => {
        deps.pendingCallbacks.onPendingOrderSettled?.(localId, serverOrderId)
        deps.notify.toastSuccess(successMessage)
      },
      onFailed: deps.notify.onPendingFailed,
    })
    return
  }
  try {
    const order = await deps.createOrder(payload)
    deps.notify.onNavigateCreated(order.id, successMessage)
  } catch (error) {
    reportIntakeCreateFailure(vehicle, error, deps)
  }
}

function reportIntakeCreateFailure(vehicle: ExistingVehicle, error: unknown, deps: IntakeCreateDeps) {
  const conflict = conflictFromError(error, {
    vehicleId: vehicle.id,
    tab: deps.activeTab,
    formSignature: deps.formSignature,
  })
  if (conflict && deps.isCurrentAttempt()) {
    deps.notify.onConflict(conflict)
    return
  }
  deps.notify.toastError(conflict?.message ?? getErrorMessage(error, deps.messages.createFailed))
}
