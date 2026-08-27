import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import * as React from 'react'
import { toast } from 'sonner'
import type { components } from '@/api/generated/openapi'
import { useAuthSession, useSwitchTenant, type AuthSessionMembership, type AuthSessionTenant } from '@/api/auth-session'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { useAuth } from '@/auth/AuthProvider'
import { AppSidebar } from '@/components/navigation/AppSidebar'
import { GlobalSearch } from '@/components/GlobalSearch'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { RealtimeDashboardSyncProvider } from '@/features/realtime/RealtimeDashboardSyncProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { generateId } from '@/lib/id'
import { isMechanicPath, isPlatformPath } from '@/lib/shell-paths'
import { GlobalErrorBoundary } from '@/components/GlobalErrorBoundary'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageLoader } from '@/components/ui/PageLoader'

const LoginPage = React.lazy(() => import('@/pages/LoginPage'))
const InventoryList = React.lazy(() => import('./pages/InventoryList'))
const InventoryLedgerPage = React.lazy(() => import('./pages/inventory/InventoryLedgerPage'))
const VendorList = React.lazy(() => import('./pages/vendors/VendorList'))
const VendorDetail = React.lazy(() => import('./pages/vendors/VendorDetail'))
const PurchaseOrderList = React.lazy(() => import('./pages/purchase-orders/PurchaseOrderList'))
const PurchaseOrderCreate = React.lazy(() => import('./pages/purchase-orders/PurchaseOrderCreate'))
const PurchaseOrderDetail = React.lazy(() => import('./pages/purchase-orders/PurchaseOrderDetail'))
const InvoiceCreatePage = React.lazy(() => import('./pages/sales/InvoiceCreatePage'))
const InvoiceDetailPage = React.lazy(() => import('./pages/sales/InvoiceDetailPage'))
const PurchaseInvoiceCreatePage = React.lazy(() => import('./pages/purchase-invoices/PurchaseInvoiceCreatePage'))
const PurchaseBillsPage = React.lazy(() => import('./pages/purchase-bills/PurchaseBillsPage'))
const PurchaseBillDetailPage = React.lazy(() => import('./pages/purchase-bills/PurchaseBillDetailPage'))
const PurchaseBillCreatePage = React.lazy(() => import('./pages/purchase-bills/PurchaseBillCreatePage'))
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'))
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'))
const PlatformTenantsPage = React.lazy(() => import('./pages/platform/PlatformTenantsPage'))
const IntakeDashboard = React.lazy(() => import('./pages/workshop/IntakeDashboard').then(m => ({ default: m.IntakeDashboard })))
const WorkshopOrderDetails = React.lazy(() => import('./pages/workshop/WorkshopOrderDetails'))
const WorkshopOrderList = React.lazy(() => import('./pages/workshop/WorkshopOrderList'))
const WorkshopPickList = React.lazy(() => import('./pages/workshop/WorkshopPickList'))
const WorkshopBoard = React.lazy(() => import('./pages/workshop/WorkshopBoard'))
const WorkshopPlannerPage = React.lazy(() => import('./pages/workshop/WorkshopPlannerPage'))
const CustomerList = React.lazy(() => import('./pages/customers/CustomerList'))
const CustomerDetail = React.lazy(() => import('./pages/customers/CustomerDetail'))
const VehicleDetail = React.lazy(() => import('./pages/vehicles/VehicleDetail'))
const VehicleList = React.lazy(() => import('./pages/vehicles/VehicleList'))
const VehicleStockList = React.lazy(() => import('./pages/vehicle-stock/VehicleStockList'))
const VehicleStockDetail = React.lazy(() => import('./pages/vehicle-stock/VehicleStockDetail'))
const VehiclePurchasePage = React.lazy(() => import('./pages/vehicle-stock/VehiclePurchasePage'))
const VehicleSalePage = React.lazy(() => import('./pages/vehicle-stock/VehicleSalePage'))
const SalesOrderList = React.lazy(() => import('./pages/sales-orders/SalesOrderList'))
const SalesOrderCreate = React.lazy(() => import('./pages/sales-orders/SalesOrderCreate'))
const SalesOrderDetail = React.lazy(() => import('./pages/sales-orders/SalesOrderDetail'))
const HrLayout = React.lazy(() => import('./pages/hr/HrLayout'))
const HrEmployeesPage = React.lazy(() => import('./pages/hr/HrEmployeesPage'))
const HrClockPage = React.lazy(() => import('./pages/hr/HrClockPage'))
const HrLeavePage = React.lazy(() => import('./pages/hr/HrLeavePage'))
const MechanicQueuePage = React.lazy(() => import('./pages/mechanic/MechanicQueuePage'))
const MechanicTaskDetailPage = React.lazy(() => import('./pages/mechanic/MechanicTaskDetailPage'))

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'acp:sidebar-collapsed'

export function AppRoutes() {
  const location = useLocation()

  return (
    <LayoutGroup id="app-routes">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.16, ease: 'easeIn' } }}
        >
          <React.Suspense fallback={<PageLoader />}>
            <Routes location={location}>
              <Route path="/" element={<Navigate to="/inventory" replace />} />
              <Route path="/inventory" element={<InventoryList />} />
              <Route path="/inventory/:itemId/ledger" element={<InventoryLedgerPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/customers" element={<CustomerList />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/vehicles" element={<VehicleList />} />
              <Route path="/vehicles/:id" element={<VehicleDetail />} />
              <Route path="/vehicle-stock" element={<VehicleStockList />} />
              <Route path="/vehicle-stock/purchases/new" element={<VehiclePurchasePage />} />
              <Route path="/vehicle-stock/purchases/:id" element={<VehiclePurchasePage />} />
              <Route path="/vehicle-stock/sales/new" element={<VehicleSalePage />} />
              <Route path="/vehicle-stock/sales/:id" element={<VehicleSalePage />} />
              <Route path="/vehicle-stock/:vehicleId" element={<VehicleStockDetail />} />
              <Route path="/sales-orders" element={<SalesOrderList />} />
              <Route path="/sales-orders/new" element={<SalesOrderCreate />} />
              <Route path="/sales-orders/:id" element={<SalesOrderDetail />} />
              <Route path="/vendors" element={<VendorList />} />
              <Route path="/vendors/:id" element={<VendorDetail />} />
              <Route path="/purchase-orders" element={<PurchaseOrderList />} />
              <Route path="/purchase-orders/new" element={<PurchaseOrderCreate />} />
              <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
              <Route path="/purchase-bills" element={<PurchaseBillsPage />} />
              <Route path="/purchase-bills/new" element={<PurchaseBillCreatePage />} />
              <Route path="/purchase-bills/:id" element={<PurchaseBillDetailPage />} />
              <Route path="/sales/invoices/new" element={<InvoiceCreatePage />} />
              <Route path="/sales/invoices/:id" element={<InvoiceDetailPage />} />
              <Route path="/purchase-invoices/new" element={<PurchaseInvoiceCreatePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/hr" element={<HrLayout />}>
                <Route index element={<Navigate to="employees" replace />} />
                <Route path="employees" element={<HrEmployeesPage />} />
                <Route path="clock" element={<HrClockPage />} />
                <Route path="leave" element={<HrLeavePage />} />
              </Route>
              <Route path="/platform/tenants" element={<PlatformTenantsPage />} />
              <Route path="/workshop/intake" element={<IntakeDashboard />} />
              <Route path="/workshop/orders" element={<WorkshopOrderList />} />
              <Route path="/workshop/pick-list" element={<WorkshopPickList />} />
              <Route path="/workshop/board" element={<WorkshopBoard />} />
              <Route path="/workshop/planner" element={<WorkshopPlannerPage />} />
              <Route path="/workshop/orders/:id" element={<WorkshopOrderDetails />} />
            </Routes>
          </React.Suspense>
        </motion.div>
      </AnimatePresence>
    </LayoutGroup>
  )
}

type AppMainProps = {
  sidebarCollapsed: boolean
}

function AppMain({ sidebarCollapsed }: AppMainProps) {
  return (
    <main
      id="main-content"
      className={cn('min-h-screen transition-[padding-left] duration-200', sidebarCollapsed ? 'pl-20' : 'pl-72')}
      tabIndex={-1}
    >
      <PageContainer>
        <GlobalErrorBoundary>
          <AppRoutes />
        </GlobalErrorBoundary>
      </PageContainer>
      <Toaster />
    </main>
  )
}

type AppShellProps = {
  userId?: string
  userEmail: string | null
  platformRole: string | null
  activeTenant: AuthSessionTenant | null
  activeRole: components['schemas']['TenantMemberRole'] | null
  memberships: AuthSessionMembership[]
  isSwitchingTenant: boolean
  onSwitchTenant: (tenantId: string) => void
  onSignOut: () => void
}

function AppShell({
  userId,
  userEmail,
  platformRole,
  activeTenant,
  activeRole,
  memberships,
  isSwitchingTenant,
  onSwitchTenant,
  onSignOut,
}: AppShellProps) {
  const [deviceId] = React.useState(() => {
    if (typeof window === 'undefined') return 'server'
    const stored = window.localStorage.getItem('deviceId')
    if (stored) return stored
    const newId = generateId()
    window.localStorage.setItem('deviceId', newId)
    return newId
  })

  const effectiveUserKey = userId ?? userEmail ?? `anon-${deviceId}`
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  })

  React.useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  React.useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <SavedViewsProvider userKey={effectiveUserKey}>
      <DashboardWidgetsProvider userKey={effectiveUserKey}>
        <RealtimeDashboardSyncProvider>
          <div className="min-h-screen bg-slate-100">
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
            >
              Skip to main content
            </a>

            <AppSidebar
              userEmail={userEmail}
              platformRole={platformRole}
              activeTenant={activeTenant}
              activeRole={activeRole}
              memberships={memberships}
              collapsed={sidebarCollapsed}
              isSwitchingTenant={isSwitchingTenant}
              onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
              onOpenSearch={() => setSearchOpen(true)}
              onSwitchTenant={onSwitchTenant}
              onSignOut={onSignOut}
            />

            <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
            <AppMain sidebarCollapsed={sidebarCollapsed} />
          </div>
        </RealtimeDashboardSyncProvider>
      </DashboardWidgetsProvider>
    </SavedViewsProvider>
  )
}

// ─── Mechanic Shell ───────────────────────────────────────────────────────────

type MechanicShellProps = {
  activeTenant: AuthSessionTenant | null
  userEmail: string | null
  onSignOut: () => void
}

function MechanicRoutes() {
  const location = useLocation()
  return (
    <LayoutGroup id="mechanic-routes">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.16, ease: 'easeIn' } }}
        >
          <React.Suspense fallback={<PageLoader />}>
            <Routes location={location}>
              <Route path="/mechanic/queue" element={<MechanicQueuePage />} />
              <Route path="/mechanic/tasks/:taskId" element={<MechanicTaskDetailPage />} />
              <Route path="/mechanic" element={<Navigate to="/mechanic/queue" replace />} />
            </Routes>
          </React.Suspense>
        </motion.div>
      </AnimatePresence>
    </LayoutGroup>
  )
}

// ADR-0014: The stale localStorage key written by the previous client-side mechanic
// selection model.  Removing it on every shell mount ensures no residual identity
// can survive an upgrade even if the user never explicitly cleared site data.
const LEGACY_MECHANIC_ID_KEY = 'acp:mechanic-id'

export function MechanicShell({ activeTenant, userEmail, onSignOut }: MechanicShellProps) {
  React.useEffect(() => {
    window.localStorage.removeItem(LEGACY_MECHANIC_ID_KEY)
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Minimal top bar — hides all admin/billing navigation */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight text-slate-900">ACP</span>
          {activeTenant && (
            <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {activeTenant.name}
            </span>
          )}
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Mechanic
          </span>
        </div>
        <div className="flex items-center gap-2">
          {userEmail && (
            <span className="hidden sm:block text-xs text-slate-500 truncate max-w-[160px]">
              {userEmail}
            </span>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>
      <main>
        <GlobalErrorBoundary>
          <MechanicRoutes />
        </GlobalErrorBoundary>
      </main>
      <Toaster />
    </div>
  )
}

// ─── Shell Router ─────────────────────────────────────────────────────────────

const ADMIN_HOME_PATH = '/dashboard'
const MECHANIC_HOME_PATH = '/mechanic/queue'
const SUPER_ADMIN_ROLE = 'SUPER_ADMIN'
const TECH_ROLE = 'TECH'

type ShellRouterProps = AppShellProps & {
  onSignOut: () => void
}

function resolveShellRedirect(input: {
  pathname: string
  activeRole: components['schemas']['TenantMemberRole'] | null
  platformRole: string | null
}): string | null {
  // Frontend-only UX gates. API authorization remains the source of truth.
  const mechanicPath = isMechanicPath(input.pathname)
  const mechanicMode = input.activeRole === TECH_ROLE

  if (mechanicMode && !mechanicPath) {
    return MECHANIC_HOME_PATH
  }

  if (mechanicPath && !mechanicMode) {
    return ADMIN_HOME_PATH
  }

  if (isPlatformPath(input.pathname) && input.platformRole !== SUPER_ADMIN_ROLE) {
    return ADMIN_HOME_PATH
  }

  return null
}

export function ShellRouter(props: ShellRouterProps) {
  const location = useLocation()
  const redirectTo = resolveShellRedirect({
    pathname: location.pathname,
    activeRole: props.activeRole,
    platformRole: props.platformRole,
  })

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />
  }

  if (isMechanicPath(location.pathname)) {
    return (
      <MechanicShell
        activeTenant={props.activeTenant}
        userEmail={props.userEmail}
        onSignOut={props.onSignOut}
      />
    )
  }

  return <AppShell {...props} />
}

function App() {
  const { user, loading, signOutUser } = useAuth()
  const sessionQuery = useAuthSession(user?.uid ?? user?.email ?? null, Boolean(user))
  const switchTenantMutation = useSwitchTenant()

  if (loading || (user && sessionQuery.isLoading)) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-100 text-sm text-slate-500">Loading…</div>
  }

  if (!user) {
    return (
      <GlobalErrorBoundary>
        <React.Suspense fallback={<PageLoader />}>
          <LoginPage />
        </React.Suspense>
      </GlobalErrorBoundary>
    )
  }

  if (!sessionQuery.data) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-100 text-sm text-slate-500">Unable to load your tenant session.</div>
  }

  return (
    <Router>
      <ShellRouter
        userId={user.uid}
        userEmail={user.email ?? null}
        platformRole={sessionQuery.data.platformRole ?? null}
        activeTenant={sessionQuery.data.activeTenant}
        activeRole={sessionQuery.data.activeRole}
        memberships={sessionQuery.data.memberships}
        isSwitchingTenant={switchTenantMutation.isPending}
        onSwitchTenant={(tenantId) => {
          switchTenantMutation.mutateAsync(tenantId).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'Failed to switch tenant')
          })
        }}
        onSignOut={() => void signOutUser()}
      />
    </Router>
  )
}

export default App
