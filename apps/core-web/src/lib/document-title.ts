import { matchRoutes, type RouteObject } from 'react-router-dom'
import { APP_ROUTE_PATHS, LOGIN_PATH, MECHANIC_ROUTE_PATHS } from '@/lib/app-route-paths'
import { i18n } from '@/lib/i18n'
import type nav from '../../../../locales/de/nav.json'

export const APP_DOCUMENT_TITLE = 'Auto Core'

type RouteTitleKey =
  | `modules.${keyof typeof nav.modules}`
  | `routeTitles.${Exclude<keyof typeof nav.routeTitles, 'notFound'>}`

const TITLE_SEPARATOR = ' - '

type RoutePattern =
  | (typeof APP_ROUTE_PATHS)[keyof typeof APP_ROUTE_PATHS]
  | (typeof MECHANIC_ROUTE_PATHS)[keyof typeof MECHANIC_ROUTE_PATHS]
  | typeof LOGIN_PATH

/**
 * `nav` namespace key of the section title per route pattern, named after the sidebar entry the page belongs to.
 * Typed over every route constant, so a new route without a title fails the build.
 */
export const ROUTE_SECTION_TITLES: Record<RoutePattern, RouteTitleKey> = {
  [APP_ROUTE_PATHS.home]: 'modules.inventory',
  [APP_ROUTE_PATHS.inventory]: 'modules.inventory',
  [APP_ROUTE_PATHS.inventoryLedger]: 'routeTitles.inventoryLedger',
  [APP_ROUTE_PATHS.dashboard]: 'modules.dashboard',
  [APP_ROUTE_PATHS.agentSupervision]: 'modules.agentSupervision',
  [APP_ROUTE_PATHS.customers]: 'modules.customers',
  [APP_ROUTE_PATHS.customerDetail]: 'modules.customers',
  [APP_ROUTE_PATHS.vehicles]: 'modules.vehicles',
  [APP_ROUTE_PATHS.vehicleDetail]: 'modules.vehicles',
  [APP_ROUTE_PATHS.vehiclePickerlDue]: 'modules.pickerlDue',
  [APP_ROUTE_PATHS.vehicleGewaehrleistungDue]: 'modules.gewaehrleistungDue',
  [APP_ROUTE_PATHS.vehicleStockAlias]: 'modules.vehicleStock',
  [APP_ROUTE_PATHS.vehicleStock]: 'modules.vehicleStock',
  [APP_ROUTE_PATHS.vehicleStockReports]: 'modules.vehicleStockReports',
  [APP_ROUTE_PATHS.vehicleStockListing]: 'routeTitles.vehicleStockListing',
  [APP_ROUTE_PATHS.vehicleStockDetail]: 'modules.vehicleStock',
  [APP_ROUTE_PATHS.vehicleStockPurchaseNew]: 'routeTitles.vehicleStockPurchaseNew',
  [APP_ROUTE_PATHS.vehicleStockPurchaseDetail]: 'routeTitles.vehicleStockPurchaseDetail',
  [APP_ROUTE_PATHS.vehicleStockSaleNew]: 'routeTitles.vehicleStockSaleNew',
  [APP_ROUTE_PATHS.vehicleStockSaleDetail]: 'routeTitles.vehicleStockSaleDetail',
  [APP_ROUTE_PATHS.workshopKpiReports]: 'modules.workshopKpiReports',
  [APP_ROUTE_PATHS.salesOrders]: 'modules.salesOrders',
  [APP_ROUTE_PATHS.salesOrderNew]: 'routeTitles.salesOrderNew',
  [APP_ROUTE_PATHS.salesOrderDetail]: 'modules.salesOrders',
  [APP_ROUTE_PATHS.vendors]: 'modules.vendors',
  [APP_ROUTE_PATHS.vendorDetail]: 'modules.vendors',
  [APP_ROUTE_PATHS.purchaseOrders]: 'modules.purchaseOrders',
  [APP_ROUTE_PATHS.purchaseOrderNew]: 'routeTitles.purchaseOrderNew',
  [APP_ROUTE_PATHS.purchaseOrderDetail]: 'modules.purchaseOrders',
  [APP_ROUTE_PATHS.stockTransfers]: 'modules.stockTransfers',
  [APP_ROUTE_PATHS.stockTransferDetail]: 'modules.stockTransfers',
  [APP_ROUTE_PATHS.purchaseBills]: 'modules.purchaseBills',
  [APP_ROUTE_PATHS.purchaseBillNew]: 'routeTitles.purchaseBillNew',
  [APP_ROUTE_PATHS.purchaseBillDetail]: 'modules.purchaseBills',
  [APP_ROUTE_PATHS.salesInvoices]: 'modules.salesInvoices',
  [APP_ROUTE_PATHS.salesInvoiceNew]: 'routeTitles.salesInvoiceNew',
  [APP_ROUTE_PATHS.salesInvoiceEdit]: 'routeTitles.salesInvoiceEdit',
  [APP_ROUTE_PATHS.salesInvoiceDetail]: 'modules.salesInvoices',
  [APP_ROUTE_PATHS.financeInvoices]: 'modules.salesInvoices',
  [APP_ROUTE_PATHS.invoicesLegacy]: 'modules.salesInvoices',
  [APP_ROUTE_PATHS.creditNotes]: 'modules.creditNotes',
  [APP_ROUTE_PATHS.creditNoteDetail]: 'modules.creditNotes',
  [APP_ROUTE_PATHS.accountingExportReadiness]: 'modules.accountingExportReadiness',
  [APP_ROUTE_PATHS.purchaseInvoiceNew]: 'routeTitles.purchaseInvoiceNew',
  [APP_ROUTE_PATHS.settings]: 'modules.settings',
  [APP_ROUTE_PATHS.hr]: 'modules.hr',
  [APP_ROUTE_PATHS.hrEmployees]: 'routeTitles.hrEmployees',
  [APP_ROUTE_PATHS.hrClock]: 'routeTitles.hrClock',
  [APP_ROUTE_PATHS.hrLeave]: 'routeTitles.hrLeave',
  [APP_ROUTE_PATHS.platformTenants]: 'modules.platformTenants',
  [APP_ROUTE_PATHS.workshopIntake]: 'routeTitles.workshopIntake',
  [APP_ROUTE_PATHS.workshopOrders]: 'modules.workshopOrders',
  [APP_ROUTE_PATHS.workshopPick]: 'routeTitles.workshopPick',
  [APP_ROUTE_PATHS.workshopPickList]: 'routeTitles.workshopPick',
  [APP_ROUTE_PATHS.workshopBoard]: 'modules.workshopBoard',
  [APP_ROUTE_PATHS.workshopPlanner]: 'modules.workshopPlanner',
  [APP_ROUTE_PATHS.workshopCapacity]: 'modules.workshopCapacity',
  [APP_ROUTE_PATHS.workshopLoanerVehicles]: 'modules.workshopLoanerVehicles',
  [APP_ROUTE_PATHS.workshopLoanerBookingPrint]: 'routeTitles.workshopLoanerBookingPrint',
  [APP_ROUTE_PATHS.workshopOrderDetail]: 'modules.workshopOrders',
  [APP_ROUTE_PATHS.workshopOrderCheckIn]: 'modules.workshopOrders',
  [APP_ROUTE_PATHS.workshopOrderWarrantyClaims]: 'routeTitles.workshopOrderWarrantyClaims',
  [APP_ROUTE_PATHS.tyreStorage]: 'modules.tyreStorage',
  [APP_ROUTE_PATHS.tyreStorageDetail]: 'modules.tyreStorage',
  [MECHANIC_ROUTE_PATHS.queue]: 'routeTitles.mechanicQueue',
  [MECHANIC_ROUTE_PATHS.taskDetail]: 'routeTitles.mechanicTask',
  [MECHANIC_ROUTE_PATHS.root]: 'routeTitles.mechanicQueue',
  [LOGIN_PATH]: 'routeTitles.login',
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
    return i18n.t('routeTitles.notFound', { ns: 'nav' })
  }
  if (pattern === APP_ROUTE_PATHS.workshopOrderCheckIn) {
    return i18n.t('checkIn.pageTitleFallback', { ns: 'workshop' })
  }
  return i18n.t(ROUTE_SECTION_TITLES[pattern], { ns: 'nav' })
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
