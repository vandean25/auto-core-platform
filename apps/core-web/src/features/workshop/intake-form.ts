import type { RegisterIntakePayload } from '@/api/types'
import {
  getErrorBody,
  getErrorCode,
  getErrorMessage,
  VEHICLE_HAS_ACTIVE_ORDER_CODE,
} from '@/lib/error-utils'

export type IntakeTab = 'existing' | 'new-vehicle' | 'registration-document'
export type IntakeCustomerMode = 'existing' | 'new'

export interface NewVehicleForm {
  vin: string
  plate: string
  make: string
  model: string
  year: string
}

export interface NewCustomerForm {
  firstName: string
  lastName: string
  email: string
  phone: string
}

/** A live order that blocked an intake attempt, shown on the tab that produced it. */
export interface ExistingOrderConflict {
  message: string
  orderId: string
  orderNumber?: string
  vehicleId: string
  tab: IntakeTab
  /** The new-vehicle form the conflict came from; the alert hides once that form differs. */
  formSignature?: string
}

export function emptyVehicleForm(): NewVehicleForm {
  return { vin: '', plate: '', make: '', model: '', year: String(new Date().getFullYear()) }
}

export function emptyCustomerForm(): NewCustomerForm {
  return { firstName: '', lastName: '', email: '', phone: '' }
}

export function canSubmitOrder(input: {
  tab: IntakeTab
  selectedVehicleCustomerId?: string
  newVehicle: NewVehicleForm
  newCustomer: NewCustomerForm
  customerMode: IntakeCustomerMode
  selectedCustomerId?: string
  odometer: string
  fuelLevel: string
}): boolean {
  const intakeValid = Number(input.odometer) >= 0 && Number(input.fuelLevel) >= 0
  if (input.tab === 'existing') {
    return Boolean(input.selectedVehicleCustomerId) && intakeValid
  }

  const { newVehicle, newCustomer } = input
  const vehicleValid =
    Boolean(newVehicle.vin.trim() && newVehicle.plate.trim() && newVehicle.make.trim() && newVehicle.model.trim()) &&
    Number(newVehicle.year) >= 1900
  if (!vehicleValid || !intakeValid) {
    return false
  }
  if (input.customerMode === 'existing') {
    return Boolean(input.selectedCustomerId)
  }
  return Boolean(newCustomer.firstName.trim() && newCustomer.lastName.trim())
}

export function buildRegisterPayload(
  newVehicle: NewVehicleForm,
  newCustomer: NewCustomerForm,
  customerMode: IntakeCustomerMode,
  selectedCustomerId?: string,
): RegisterIntakePayload {
  const payload: RegisterIntakePayload = {
    vin: newVehicle.vin.trim(),
    plate: newVehicle.plate.trim(),
    make: newVehicle.make.trim(),
    model: newVehicle.model.trim(),
    year: Number(newVehicle.year),
  }
  if (customerMode === 'existing') {
    payload.customerId = selectedCustomerId
    return payload
  }
  payload.firstName = newCustomer.firstName.trim()
  payload.lastName = newCustomer.lastName.trim()
  payload.email = newCustomer.email.trim() || undefined
  payload.phone = newCustomer.phone.trim() || undefined
  return payload
}

/** The conflict to show for a failed attempt, or null when the error is not a live-order conflict for a known vehicle. */
export function conflictFromError(
  error: unknown,
  attempt: { vehicleId?: string; tab: IntakeTab; formSignature: string },
): ExistingOrderConflict | null {
  const body = getErrorBody(error)
  if (!attempt.vehicleId || getErrorCode(error) !== VEHICLE_HAS_ACTIVE_ORDER_CODE || !body?.orderId) {
    return null
  }
  return {
    message: getErrorMessage(error, 'Failed to create workshop order'),
    orderId: body.orderId,
    orderNumber: body.orderNumber,
    vehicleId: attempt.vehicleId,
    tab: attempt.tab,
    formSignature: attempt.tab === 'new-vehicle' ? attempt.formSignature : undefined,
  }
}

/**
 * A conflict is shown only on the tab that produced it. Existing-tab conflicts must match the selected vehicle,
 * and new-vehicle conflicts must match the form that produced them.
 */
export function visibleConflict(
  conflict: ExistingOrderConflict | null,
  view: { tab: IntakeTab; selectedVehicleId?: string; formSignature: string },
): ExistingOrderConflict | null {
  if (!conflict || conflict.tab !== view.tab) {
    return null
  }
  const matches =
    view.tab === 'new-vehicle'
      ? conflict.formSignature === view.formSignature
      : conflict.vehicleId === view.selectedVehicleId
  return matches ? conflict : null
}
