import { matchRoutes, type RouteObject } from 'react-router-dom'
import { APP_ROUTE_PATHS, LOGIN_PATH, MECHANIC_ROUTE_PATHS } from '@/lib/app-route-paths'
import { i18n } from '@/lib/i18n'

export const APP_DOCUMENT_TITLE = 'Auto Core'
export const NOT_FOUND_SECTION_TITLE = 'Page not found'

const TITLE_SEPARATOR = ' - '

type RoutePattern =
  | (typeof APP_ROUTE_PATHS)[keyof typeof APP_ROUTE_PATHS]
  | (typeof MECHANIC_ROUTE_PATHS)[keyof typeof MECHANIC_ROUTE_PATHS]
  | typeof LOGIN_PATH

/**
 * Section title per route pattern, named after the sidebar entry the page belongs to.
 * Typed over every route constant, so a new route without a title fails the build.
 */
export const ROUTE_SECTION_TITLES: Record<RoutePattern, string> = {
  [APP_ROUTE_PATHS.home]: 'Inventory',
  [APP_ROUTE_PATHS.inventory]: 'Inventory',
  [APP_ROUTE_PATHS.inventoryLedger]: 'Inventory Ledger',
  [APP_ROUTE_PATHS.dashboard]: 'Dashboard',
  [APP_ROUTE_PATHS.agentSupervision]: 'Agent Supervision',
  [APP_ROUTE_PATHS.customers]: 'Customers',
  [APP_ROUTE_PATHS.customerDetail]: 'Customers',
  [APP_ROUTE_PATHS.vehicles]: 'Vehicles',
  [APP_ROUTE_PATHS.vehicleDetail]: 'Vehicles',
  [APP_ROUTE_PATHS.vehiclePickerlDue]: 'Pickerl fällig',
  [APP_ROUTE_PATHS.vehicleGewaehrleistungDue]: 'Gewährleistung fällig',
  [APP_ROUTE_PATHS.vehicleStockAlias]: 'Vehicle Stock',
  [APP_ROUTE_PATHS.vehicleStock]: 'Vehicle Stock',
  [APP_ROUTE_PATHS.vehicleStockReports]: 'Vehicle Stock Reports',
  [APP_ROUTE_PATHS.vehicleStockDetail]: 'Vehicle Stock',
  [APP_ROUTE_PATHS.vehicleStockPurchaseNew]: 'New Vehicle Purchase',
  [APP_ROUTE_PATHS.vehicleStockPurchaseDetail]: 'Vehicle Purchase',
  [APP_ROUTE_PATHS.vehicleStockSaleNew]: 'New Vehicle Sale',
  [APP_ROUTE_PATHS.vehicleStockSaleDetail]: 'Vehicle Sale',
  [APP_ROUTE_PATHS.workshopKpiReports]: 'Workshop KPIs',
  [APP_ROUTE_PATHS.salesOrders]: 'Sales Orders',
  [APP_ROUTE_PATHS.salesOrderNew]: 'New Sales Order',
  [APP_ROUTE_PATHS.salesOrderDetail]: 'Sales Orders',
  [APP_ROUTE_PATHS.vendors]: 'Vendors',
  [APP_ROUTE_PATHS.vendorDetail]: 'Vendors',
  [APP_ROUTE_PATHS.purchaseOrders]: 'Purchase Orders',
  [APP_ROUTE_PATHS.purchaseOrderNew]: 'New Purchase Order',
  [APP_ROUTE_PATHS.purchaseOrderDetail]: 'Purchase Orders',
  [APP_ROUTE_PATHS.stockTransfers]: 'Transfers',
  [APP_ROUTE_PATHS.stockTransferDetail]: 'Transfers',
  [APP_ROUTE_PATHS.purchaseBills]: 'Purchase Bills',
  [APP_ROUTE_PATHS.purchaseBillNew]: 'New Purchase Bill',
  [APP_ROUTE_PATHS.purchaseBillDetail]: 'Purchase Bills',
  [APP_ROUTE_PATHS.salesInvoices]: 'Invoices',
  [APP_ROUTE_PATHS.salesInvoiceNew]: 'New Invoice',
  [APP_ROUTE_PATHS.salesInvoiceEdit]: 'Edit Invoice',
  [APP_ROUTE_PATHS.salesInvoiceDetail]: 'Invoices',
  [APP_ROUTE_PATHS.financeInvoices]: 'Invoices',
  [APP_ROUTE_PATHS.invoicesLegacy]: 'Invoices',
  [APP_ROUTE_PATHS.creditNotes]: 'Credit Notes',
  [APP_ROUTE_PATHS.creditNoteDetail]: 'Credit Notes',
  [APP_ROUTE_PATHS.accountingExportReadiness]: 'Accounting Export Readiness',
  [APP_ROUTE_PATHS.purchaseInvoiceNew]: 'New Purchase Invoice',
  [APP_ROUTE_PATHS.settings]: 'Settings',
  [APP_ROUTE_PATHS.hr]: 'HR',
  [APP_ROUTE_PATHS.hrEmployees]: 'HR Employees',
  [APP_ROUTE_PATHS.hrClock]: 'HR Clock',
  [APP_ROUTE_PATHS.hrLeave]: 'HR Leave',
  [APP_ROUTE_PATHS.platformTenants]: 'Tenants',
  [APP_ROUTE_PATHS.workshopIntake]: 'Workshop Intake',
  [APP_ROUTE_PATHS.workshopOrders]: 'Workshop Orders',
  [APP_ROUTE_PATHS.workshopPick]: 'Parts pick queue',
  [APP_ROUTE_PATHS.workshopPickList]: 'Parts pick queue',
  [APP_ROUTE_PATHS.workshopBoard]: 'Workshop Board',
  [APP_ROUTE_PATHS.workshopPlanner]: 'Workshop Planner',
  [APP_ROUTE_PATHS.workshopCapacity]: 'Workshop Capacity',
  [APP_ROUTE_PATHS.workshopLoanerVehicles]: 'Ersatzfahrzeuge',
  [APP_ROUTE_PATHS.workshopLoanerBookingPrint]: 'Ersatzwagen Protokoll',
  [APP_ROUTE_PATHS.workshopOrderDetail]: 'Workshop Orders',
  [APP_ROUTE_PATHS.workshopOrderCheckIn]: 'Vehicle check-in',
  [APP_ROUTE_PATHS.workshopOrderWarrantyClaims]: 'Garantie/Kulanz',
  [APP_ROUTE_PATHS.tyreStorage]: 'Reifenlager',
  [APP_ROUTE_PATHS.tyreStorageDetail]: 'Reifenlager',
  [MECHANIC_ROUTE_PATHS.queue]: 'Mechanic Queue',
  [MECHANIC_ROUTE_PATHS.taskDetail]: 'Mechanic Task',
  [MECHANIC_ROUTE_PATHS.root]: 'Mechanic Queue',
  [LOGIN_PATH]: 'Sign in',
}

const ROUTE_OBJECTS: RouteObject[] = (Object.keys(ROUTE_SECTION_TITLES) as RoutePattern[]).map(
  (path) => ({ path }),
)

/** The route pattern (e.g. `/customers/:id`) that serves `pathname`, or null when none does. */
export function matchRoutePattern(pathname: string): RoutePattern | null {
  const pattern = matchRoutes(ROUTE_OBJECTS, pathname)?.at(-1)?.route.path
  return pattern ? (pattern as RoutePattern) : null
}

/** Section title for `pathname`. Unknown paths get the not-found title. */
export function getRouteSectionTitle(pathname: string): string {
  const pattern = matchRoutePattern(pathname)
  if (!pattern) {
    return NOT_FOUND_SECTION_TITLE
  }
  if (pattern === APP_ROUTE_PATHS.workshopOrderCheckIn) {
    return i18n.t('checkIn.pageTitleFallback', { ns: 'workshop' })
  }
  return ROUTE_SECTION_TITLES[pattern]
}

/** Joins the non-blank parts with the app name, e.g. `['WO-1', 'Workshop Orders']` → `WO-1 - Workshop Orders - Auto Core`. */
export function formatDocumentTitle(parts: ReadonlyArray<string | null | undefined>): string {
  const segments = parts.filter((part): part is string => Boolean(part?.trim()))
  return [...segments, APP_DOCUMENT_TITLE].join(TITLE_SEPARATOR)
}

/** Default document title for `pathname`: the section title plus the app name. */
export function getRouteDocumentTitle(pathname: string): string {
  return formatDocumentTitle([getRouteSectionTitle(pathname)])
}
