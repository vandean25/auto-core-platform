import { matchRoutes, type RouteObject } from 'react-router-dom'

/**
 * Known application paths used to distinguish real routes from unknown URLs
 * before the authenticated shell mounts (e.g. logged-out 404 vs login redirect).
 */
const APP_ROUTE_OBJECTS: RouteObject[] = [
  { path: '/' },
  { path: '/inventory' },
  { path: '/inventory/:itemId/ledger' },
  { path: '/dashboard' },
  { path: '/customers' },
  { path: '/customers/:id' },
  { path: '/vehicles' },
  { path: '/vehicles/:id' },
  { path: '/vehicle-stock' },
  { path: '/vehicle-stock/purchases/new' },
  { path: '/vehicle-stock/purchases/:id' },
  { path: '/vehicle-stock/sales/new' },
  { path: '/vehicle-stock/sales/:id' },
  { path: '/vehicle-stock/:vehicleId' },
  { path: '/sales-orders' },
  { path: '/sales-orders/new' },
  { path: '/sales-orders/:id' },
  { path: '/vendors' },
  { path: '/vendors/:id' },
  { path: '/purchase-orders' },
  { path: '/purchase-orders/new' },
  { path: '/purchase-orders/:id' },
  { path: '/purchase-bills' },
  { path: '/purchase-bills/new' },
  { path: '/purchase-bills/:id' },
  { path: '/sales/invoices/new' },
  { path: '/sales/invoices/:id' },
  { path: '/purchase-invoices/new' },
  { path: '/settings' },
  { path: '/hr' },
  { path: '/hr/employees' },
  { path: '/hr/clock' },
  { path: '/hr/leave' },
  { path: '/platform/tenants' },
  { path: '/workshop/intake' },
  { path: '/workshop/orders' },
  { path: '/workshop/pick-list' },
  { path: '/workshop/board' },
  { path: '/workshop/planner' },
  { path: '/workshop/orders/:id' },
  { path: '/mechanic/queue' },
  { path: '/mechanic/tasks/:taskId' },
  { path: '/mechanic' },
]

export function isKnownAppPath(pathname: string) {
  return matchRoutes(APP_ROUTE_OBJECTS, pathname) !== null
}
