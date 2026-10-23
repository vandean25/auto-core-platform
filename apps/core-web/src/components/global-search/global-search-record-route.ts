import { matchPath } from 'react-router-dom'

import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

export type GlobalSearchRecordRef =
  | { entity: 'workshop_order'; id: string }
  | { entity: 'customer'; id: string }
  | { entity: 'vehicle'; id: string }

const RESERVED_VEHICLE_DETAIL_SEGMENTS = new Set([
  APP_ROUTE_PATHS.vehiclePickerlDue.replace('/vehicles/', ''),
  APP_ROUTE_PATHS.vehicleGewaehrleistungDue.replace('/vehicles/', ''),
  APP_ROUTE_PATHS.vehicleStockAlias.replace('/vehicles/', ''),
])

export function parseGlobalSearchRecordRef(pathname: string): GlobalSearchRecordRef | null {
  const workshopOrder = matchPath({ path: APP_ROUTE_PATHS.workshopOrderDetail, end: true }, pathname)
  if (workshopOrder?.params.id) {
    return { entity: 'workshop_order', id: workshopOrder.params.id }
  }

  const customer = matchPath({ path: APP_ROUTE_PATHS.customerDetail, end: true }, pathname)
  if (customer?.params.id) {
    return { entity: 'customer', id: customer.params.id }
  }

  const vehicle = matchPath({ path: APP_ROUTE_PATHS.vehicleDetail, end: true }, pathname)
  const vehicleId = vehicle?.params.id
  if (vehicleId && !RESERVED_VEHICLE_DETAIL_SEGMENTS.has(vehicleId)) {
    return { entity: 'vehicle', id: vehicleId }
  }

  return null
}
