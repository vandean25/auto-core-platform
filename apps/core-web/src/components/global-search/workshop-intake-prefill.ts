import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

export type WorkshopIntakePrefill = {
  customerId?: string
  vehicleId?: string
}

const PREFILL_PARAM_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseWorkshopIntakePrefillId(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return PREFILL_PARAM_UUID_RE.test(trimmed) ? trimmed : undefined
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
  const customerId = parseWorkshopIntakePrefillId(params.get('customerId'))
  const vehicleId = parseWorkshopIntakePrefillId(params.get('vehicleId'))
  return { customerId, vehicleId }
}
