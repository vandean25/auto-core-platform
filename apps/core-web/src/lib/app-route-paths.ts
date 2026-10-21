import { matchRoutes, type RouteObject } from 'react-router-dom'

export const LOGIN_PATH = '/login' as const

/** Optional dedicated finish route; behaves the same as {@link LOGIN_PATH}. */
export const LANDING_DEMO_SIGN_IN_FINISH_ALT_PATH = '/login/email-link' as const

export const APP_ROUTE_PATHS = {
  home: '/',
  inventory: '/inventory',
  inventoryLedger: '/inventory/:itemId/ledger',
  dashboard: '/dashboard',
  customers: '/customers',
  customerDetail: '/customers/:id',
  vehicles: '/vehicles',
  vehicleDetail: '/vehicles/:id',
  vehiclePickerlDue: '/vehicles/pickerl-due',
  vehicleGewaehrleistungDue: '/vehicles/gewaehrleistung-due',
  vehicleStockAlias: '/vehicles/stock',
  vehicleStock: '/vehicle-stock',
  vehicleStockReports: '/vehicle-stock/reports',
  workshopKpiReports: '/workshop/reports/kpis',
  vehicleStockPurchaseNew: '/vehicle-stock/purchases/new',
  vehicleStockPurchaseDetail: '/vehicle-stock/purchases/:id',
  vehicleStockSaleNew: '/vehicle-stock/sales/new',
  vehicleStockSaleDetail: '/vehicle-stock/sales/:id',
  vehicleStockListing: '/vehicle-stock/:vehicleId/listing',
  vehicleStockDetail: '/vehicle-stock/:vehicleId',
  salesOrders: '/sales-orders',
  salesOrderNew: '/sales-orders/new',
  salesOrderDetail: '/sales-orders/:id',
  vendors: '/vendors',
  vendorDetail: '/vendors/:id',
  purchaseOrders: '/purchase-orders',
  purchaseOrderNew: '/purchase-orders/new',
  purchaseOrderDetail: '/purchase-orders/:id',
  stockTransfers: '/stock-transfers',
  stockTransferDetail: '/stock-transfers/:id',
  purchaseBills: '/purchase-bills',
  purchaseBillNew: '/purchase-bills/new',
  purchaseBillDetail: '/purchase-bills/:id',
  salesInvoices: '/sales/invoices',
  salesInvoiceNew: '/sales/invoices/new',
  salesInvoiceEdit: '/sales/invoices/:id/edit',
  salesInvoiceDetail: '/sales/invoices/:id',
  financeInvoices: '/finance/invoices',
  invoicesLegacy: '/invoices',
  creditNotes: '/finance/credit-notes',
  creditNoteDetail: '/finance/credit-notes/:id',
  accountingExportReadiness: '/finance/accounting-export-readiness',
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
  workshopCapacity: '/workshop/capacity',
  workshopLoanerVehicles: '/workshop/loaner-vehicles',
  workshopLoanerBookingPrint: '/workshop/loaner-bookings/:id/print',
  workshopOrderDetail: '/workshop/orders/:id',
  workshopOrderCheckIn: '/workshop/orders/:id/check-in',
  workshopOrderWarrantyClaims: '/workshop/orders/:id/garantie-kulanz',
  tyreStorage: '/workshop/tyre-storage',
  tyreStorageDetail: '/workshop/tyre-storage/:id',
  agentSupervision: '/agent/supervision',
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
