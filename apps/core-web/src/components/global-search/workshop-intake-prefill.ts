import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

export type WorkshopIntakePrefill = {
  customerId?: string
  vehicleId?: string
}

export function buildWorkshopIntakePrefillHref(prefill: WorkshopIntakePrefill): string {
  const params = new URLSearchParams()
  if (prefill.vehicleId) params.set('vehicleId', prefill.vehicleId)
  if (prefill.customerId) params.set('customerId', prefill.customerId)
  const query = params.toString()
  return query ? `${APP_ROUTE_PATHS.workshopIntake}?${query}` : APP_ROUTE_PATHS.workshopIntake
}

export function readWorkshopIntakePrefillFromSearch(search: string): WorkshopIntakePrefill {
  const params = new URLSearchParams(search)
  const customerId = params.get('customerId')?.trim() || undefined
  const vehicleId = params.get('vehicleId')?.trim() || undefined
  return { customerId, vehicleId }
}
