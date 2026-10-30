import * as React from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { APP_ROUTE_PATHS, MECHANIC_ROUTE_PATHS } from '@/lib/app-route-paths'
import { isAgentSupervisionEnabled } from '@/lib/runtime-flags'
import { PageLoader } from '@/components/ui/PageLoader'
import * as Lazy from './lazy-app-pages'
import { WorkshopNamespaceLayout } from '@/features/workshop/WorkshopNamespaceLayout'

export function AppRoutes() {
  const location = useLocation()

  return (
    <LayoutGroup id="app-routes">
      <React.Suspense fallback={<PageLoader />}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } }}
            exit={{ opacity: 0, transition: { duration: 0.16, ease: 'easeIn' } }}
          >
            <Routes location={location}>
              <Route path={APP_ROUTE_PATHS.home} element={<Navigate to={APP_ROUTE_PATHS.inventory} replace />} />
              <Route path={APP_ROUTE_PATHS.inventory} element={<Lazy.InventoryList />} />
              <Route path={APP_ROUTE_PATHS.inventoryLedger} element={<Lazy.InventoryLedgerPage />} />
              <Route path={APP_ROUTE_PATHS.dashboard} element={<Lazy.DashboardPage />} />
              <Route
                path={APP_ROUTE_PATHS.agentSupervision}
                element={
                  isAgentSupervisionEnabled() ? (
                    <Lazy.AgentSupervisionPage />
                  ) : (
                    <Navigate to={APP_ROUTE_PATHS.home} replace />
                  )
                }
              />
              <Route path={APP_ROUTE_PATHS.customers} element={<Lazy.CustomerList />} />
              <Route path={APP_ROUTE_PATHS.customerDetail} element={<Lazy.CustomerDetail />} />
              <Route path={APP_ROUTE_PATHS.vehicles} element={<Lazy.VehicleList />} />
              <Route path={APP_ROUTE_PATHS.vehiclePickerlDue} element={<React.Suspense fallback={<PageLoader />}><Lazy.PickerlDueList /></React.Suspense>} />
              <Route path={APP_ROUTE_PATHS.vehicleGewaehrleistungDue} element={<React.Suspense fallback={<PageLoader />}><Lazy.GewaehrleistungDueList /></React.Suspense>} />
              <Route
                path={APP_ROUTE_PATHS.vehicleStockAlias}
                element={<Navigate to={APP_ROUTE_PATHS.vehicleStock} replace />}
              />
              <Route path={APP_ROUTE_PATHS.vehicleDetail} element={<Lazy.VehicleDetail />} />
              <Route path={APP_ROUTE_PATHS.vehicleStock} element={<Lazy.VehicleStockList />} />
              <Route path={APP_ROUTE_PATHS.vehicleStockReports} element={<Lazy.VehicleStockReportsPage />} />
              <Route path={APP_ROUTE_PATHS.workshopKpiReports} element={<Lazy.WorkshopKpiReportsPage />} />
              <Route path={APP_ROUTE_PATHS.workshopEstimates} element={<Lazy.WorkshopEstimateList />} />
              <Route path={APP_ROUTE_PATHS.vehicleStockPurchaseNew} element={<Lazy.VehiclePurchasePage />} />
              <Route path={APP_ROUTE_PATHS.vehicleStockPurchaseDetail} element={<Lazy.VehiclePurchasePage />} />
              <Route path={APP_ROUTE_PATHS.vehicleStockSaleNew} element={<Lazy.VehicleSalePage />} />
              <Route path={APP_ROUTE_PATHS.vehicleStockSaleDetail} element={<Lazy.VehicleSalePage />} />
              <Route path={APP_ROUTE_PATHS.vehicleStockListing} element={<Lazy.VehicleListingEditorPage />} />
              <Route path={APP_ROUTE_PATHS.vehicleStockDetail} element={<Lazy.VehicleStockDetail />} />
              <Route path={APP_ROUTE_PATHS.salesOrders} element={<Lazy.SalesOrderList />} />
              <Route path={APP_ROUTE_PATHS.salesOrderNew} element={<Lazy.SalesOrderCreate />} />
              <Route path={APP_ROUTE_PATHS.salesOrderDetail} element={<Lazy.SalesOrderDetail />} />
              <Route path={APP_ROUTE_PATHS.vendors} element={<Lazy.VendorList />} />
              <Route path={APP_ROUTE_PATHS.vendorDetail} element={<Lazy.VendorDetail />} />
              <Route path={APP_ROUTE_PATHS.purchaseOrders} element={<Lazy.PurchaseOrderList />} />
              <Route path={APP_ROUTE_PATHS.purchaseOrderNew} element={<Lazy.PurchaseOrderCreate />} />
              <Route path={APP_ROUTE_PATHS.purchaseOrderDetail} element={<Lazy.PurchaseOrderDetail />} />
              <Route path={APP_ROUTE_PATHS.stockTransfers} element={<Lazy.StockTransferList />} />
              <Route path={APP_ROUTE_PATHS.stockTransferDetail} element={<Lazy.StockTransferDetail />} />
              <Route path={APP_ROUTE_PATHS.purchaseBills} element={<Lazy.PurchaseBillsPage />} />
              <Route path={APP_ROUTE_PATHS.purchaseBillNew} element={<Lazy.PurchaseBillCreatePage />} />
              <Route path={APP_ROUTE_PATHS.purchaseBillDetail} element={<Lazy.PurchaseBillDetailPage />} />
              <Route path={APP_ROUTE_PATHS.salesInvoiceNew} element={<Lazy.SalesInvoiceNewPage />} />
              <Route path={APP_ROUTE_PATHS.salesInvoiceEdit} element={<Lazy.InvoiceDraftEditPage />} />
              <Route path={APP_ROUTE_PATHS.salesInvoiceDetail} element={<Lazy.InvoiceDetailPage />} />
              <Route path={APP_ROUTE_PATHS.salesInvoices} element={<Lazy.InvoiceListPage />} />
              <Route
                path={APP_ROUTE_PATHS.financeInvoices}
                element={<Navigate to={APP_ROUTE_PATHS.salesInvoices} replace />}
              />
              <Route
                path={APP_ROUTE_PATHS.invoicesLegacy}
                element={<Navigate to={APP_ROUTE_PATHS.salesInvoices} replace />}
              />
              <Route path={APP_ROUTE_PATHS.creditNotes} element={<Lazy.CreditNotesPage />} />
              <Route path={APP_ROUTE_PATHS.creditNoteDetail} element={<Lazy.CreditNoteDetailPage />} />
              <Route path={APP_ROUTE_PATHS.accountingExportReadiness} element={<Lazy.AccountingExportReadinessPage />} />
              <Route path={APP_ROUTE_PATHS.purchaseInvoiceNew} element={<Lazy.PurchaseInvoiceCreatePage />} />
              <Route path={APP_ROUTE_PATHS.settings} element={<Lazy.SettingsPage />} />
              <Route path={APP_ROUTE_PATHS.hr} element={<Lazy.HrLayout />}>
                <Route index element={<Navigate to="employees" replace />} />
                <Route path="employees" element={<Lazy.HrEmployeesPage />} />
                <Route path="clock" element={<Lazy.HrClockPage />} />
                <Route path="leave" element={<Lazy.HrLeavePage />} />
              </Route>
              <Route path={APP_ROUTE_PATHS.platformTenants} element={<Lazy.PlatformTenantsPage />} />
              <Route element={<WorkshopNamespaceLayout />}>
                <Route path={APP_ROUTE_PATHS.workshopIntake} element={<Lazy.IntakeDashboard />} />
                <Route path={APP_ROUTE_PATHS.workshopOrders} element={<Lazy.WorkshopOrderList />} />
                <Route
                  path={APP_ROUTE_PATHS.workshopPick}
                  element={<Navigate to={APP_ROUTE_PATHS.workshopPickList} replace />}
                />
                <Route path={APP_ROUTE_PATHS.workshopPickList} element={<Lazy.WorkshopPickList />} />
                <Route path={APP_ROUTE_PATHS.workshopBoard} element={<Lazy.WorkshopBoard />} />
                <Route path={APP_ROUTE_PATHS.workshopPlanner} element={<Lazy.WorkshopPlannerPage />} />
                <Route path={APP_ROUTE_PATHS.workshopCapacity} element={<Lazy.WorkshopCapacityPage />} />
                <Route path={APP_ROUTE_PATHS.workshopLoanerVehicles} element={<Lazy.LoanerVehiclesPage />} />
                <Route path={APP_ROUTE_PATHS.workshopLoanerBookingPrint} element={<Lazy.LoanerBookingPrintPage />} />
                <Route
                  path={APP_ROUTE_PATHS.workshopOrderCheckIn}
                  element={<Lazy.WorkshopCheckInPage />}
                />
                <Route path={APP_ROUTE_PATHS.workshopOrderDetail} element={<Lazy.WorkshopOrderLayout />}>
                  <Route index element={<Lazy.WorkshopOrderDetails />} />
                  <Route path="garantie-kulanz" element={<Lazy.WorkshopOrderWarrantyClaims />} />
                </Route>
              </Route>
              <Route path={APP_ROUTE_PATHS.tyreStorage} element={<Lazy.TyreStorageListPage />} />
              <Route path={APP_ROUTE_PATHS.tyreStorageDetail} element={<Lazy.TyreSetDetailPage />} />
              <Route path="*" element={<Lazy.NotFoundPage />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </React.Suspense>
    </LayoutGroup>
  )
}
export function MechanicRoutes() {
  const location = useLocation()
  return (
    <LayoutGroup id="mechanic-routes">
      <React.Suspense fallback={<PageLoader />}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } }}
            exit={{ opacity: 0, transition: { duration: 0.16, ease: 'easeIn' } }}
          >
            <Routes location={location}>
              <Route element={<WorkshopNamespaceLayout />}>
                <Route path={MECHANIC_ROUTE_PATHS.queue} element={<Lazy.MechanicQueuePage />} />
                <Route path={MECHANIC_ROUTE_PATHS.taskDetail} element={<Lazy.MechanicTaskDetailPage />} />
                <Route path={MECHANIC_ROUTE_PATHS.root} element={<Navigate to={MECHANIC_ROUTE_PATHS.queue} replace />} />
                <Route path={APP_ROUTE_PATHS.workshopOrderDetail} element={<Lazy.MechanicTyreReportPage />} />
                <Route path={APP_ROUTE_PATHS.tyreStorageDetail} element={<Lazy.TyreSetDetailPage />} />
              </Route>
              <Route path="*" element={<Lazy.NotFoundPage />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </React.Suspense>
    </LayoutGroup>
  )
}
