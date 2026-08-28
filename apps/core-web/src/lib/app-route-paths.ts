import { matchRoutes, type RouteObject } from 'react-router-dom'

export const LOGIN_PATH = '/login' as const

export const APP_ROUTE_PATHS = {
  home: '/',
  inventory: '/inventory',
  inventoryLedger: '/inventory/:itemId/ledger',
  dashboard: '/dashboard',
  customers: '/customers',
  customerDetail: '/customers/:id',
  vehicles: '/vehicles',
  vehicleDetail: '/vehicles/:id',
  vehicleStock: '/vehicle-stock',
  vehicleStockPurchaseNew: '/vehicle-stock/purchases/new',
  vehicleStockPurchaseDetail: '/vehicle-stock/purchases/:id',
  vehicleStockSaleNew: '/vehicle-stock/sales/new',
  vehicleStockSaleDetail: '/vehicle-stock/sales/:id',
  vehicleStockDetail: '/vehicle-stock/:vehicleId',
  salesOrders: '/sales-orders',
  salesOrderNew: '/sales-orders/new',
  salesOrderDetail: '/sales-orders/:id',
  vendors: '/vendors',
  vendorDetail: '/vendors/:id',
  purchaseOrders: '/purchase-orders',
  purchaseOrderNew: '/purchase-orders/new',
  purchaseOrderDetail: '/purchase-orders/:id',
  purchaseBills: '/purchase-bills',
  purchaseBillNew: '/purchase-bills/new',
  purchaseBillDetail: '/purchase-bills/:id',
  salesInvoiceNew: '/sales/invoices/new',
  salesInvoiceDetail: '/sales/invoices/:id',
  purchaseInvoiceNew: '/purchase-invoices/new',
  settings: '/settings',
  hr: '/hr',
  hrEmployees: '/hr/employees',
  hrClock: '/hr/clock',
  hrLeave: '/hr/leave',
  platformTenants: '/platform/tenants',
  workshopIntake: '/workshop/intake',
  workshopOrders: '/workshop/orders',
  workshopPick: '/workshop/pick',
  workshopPickList: '/workshop/pick-list',
  workshopBoard: '/workshop/board',
  workshopPlanner: '/workshop/planner',
  workshopOrderDetail: '/workshop/orders/:id',
} as const

export const MECHANIC_ROUTE_PATHS = {
  queue: '/mechanic/queue',
  taskDetail: '/mechanic/tasks/:taskId',
  root: '/mechanic',
} as const

const KNOWN_APP_ROUTE_PATHS = [
  ...Object.values(APP_ROUTE_PATHS),
  ...Object.values(MECHANIC_ROUTE_PATHS),
] as const

const APP_ROUTE_OBJECTS: RouteObject[] = KNOWN_APP_ROUTE_PATHS.map((path) => ({ path }))

export function isKnownAppPath(pathname: string) {
  return matchRoutes(APP_ROUTE_OBJECTS, pathname) !== null
}
