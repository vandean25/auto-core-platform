import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import * as React from 'react'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { useAuth } from '@/auth/AuthProvider'
import { AppSidebar } from '@/components/navigation/AppSidebar'
import { GlobalSearch } from '@/components/GlobalSearch'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { RealtimeDashboardSyncProvider } from '@/features/realtime/RealtimeDashboardSyncProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import LoginPage from '@/pages/LoginPage'
import InventoryList from './pages/InventoryList'
import InventoryLedgerPage from './pages/inventory/InventoryLedgerPage'
import VendorList from './pages/vendors/VendorList'
import VendorDetail from './pages/vendors/VendorDetail'
import PurchaseOrderList from './pages/purchase-orders/PurchaseOrderList'
import PurchaseOrderCreate from './pages/purchase-orders/PurchaseOrderCreate'
import PurchaseOrderDetail from './pages/purchase-orders/PurchaseOrderDetail'
import InvoiceCreatePage from './pages/sales/InvoiceCreatePage'
import InvoiceDetailPage from './pages/sales/InvoiceDetailPage'
import PurchaseInvoiceCreatePage from './pages/purchase-invoices/PurchaseInvoiceCreatePage'
import PurchaseBillsPage from './pages/purchase-bills/PurchaseBillsPage'
import PurchaseBillDetailPage from './pages/purchase-bills/PurchaseBillDetailPage'
import PurchaseBillCreatePage from './pages/purchase-bills/PurchaseBillCreatePage'
import SettingsPage from './pages/SettingsPage'
import DashboardPage from './pages/DashboardPage'
import { IntakeDashboard } from './pages/workshop/IntakeDashboard'
import WorkshopOrderDetails from './pages/workshop/WorkshopOrderDetails'
import WorkshopOrderList from './pages/workshop/WorkshopOrderList'
import CustomerList from './pages/customers/CustomerList'
import CustomerDetail from './pages/customers/CustomerDetail'
import VehicleDetail from './pages/vehicles/VehicleDetail'
import VehicleList from './pages/vehicles/VehicleList'
import SalesOrderList from './pages/sales-orders/SalesOrderList'
import SalesOrderCreate from './pages/sales-orders/SalesOrderCreate'
import SalesOrderDetail from './pages/sales-orders/SalesOrderDetail'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'acp:sidebar-collapsed'

function AppRoutes() {
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
          <Routes location={location}>
            <Route path="/" element={<Navigate to="/inventory" replace />} />
            <Route path="/inventory" element={<InventoryList />} />
            <Route path="/inventory/:itemId/ledger" element={<InventoryLedgerPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/customers" element={<CustomerList />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/vehicles" element={<VehicleList />} />
            <Route path="/vehicles/:id" element={<VehicleDetail />} />
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
            <Route path="/workshop/intake" element={<IntakeDashboard />} />
            <Route path="/workshop/orders" element={<WorkshopOrderList />} />
            <Route path="/workshop/orders/:id" element={<WorkshopOrderDetails />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </LayoutGroup>
  )
}

type AppMainProps = {
  sidebarCollapsed: boolean
}

function AppMain({ sidebarCollapsed }: AppMainProps) {
  const location = useLocation()
  const isWorkshopOrderDetails = /^\/workshop\/orders\/[^/]+$/.test(location.pathname)

  return (
    <main
      id="main-content"
      className={cn('min-h-screen transition-[padding-left] duration-200', sidebarCollapsed ? 'pl-20' : 'pl-72')}
      tabIndex={-1}
    >
      <div className={isWorkshopOrderDetails ? 'w-full py-8 px-0' : 'w-full py-8 px-4'}>
        <AppRoutes />
      </div>
      <Toaster />
    </main>
  )
}

type AppShellProps = {
  userId?: string
  userEmail: string | null
  onSignOut: () => void
}

function AppShell({ userId, userEmail, onSignOut }: AppShellProps) {
  const [deviceId] = React.useState(() => {
    if (typeof window === 'undefined') return 'server'
    const stored = window.localStorage.getItem('deviceId')
    if (stored) return stored
    const newId = crypto.randomUUID()
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
              collapsed={sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
              onOpenSearch={() => setSearchOpen(true)}
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

function App() {
  const { user, loading, signOutUser } = useAuth()

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
  }

  if (!user) {
    return <LoginPage />
  }

  return (
    <Router>
      <AppShell userEmail={user.email ?? null} onSignOut={() => void signOutUser()} />
    </Router>
  )
}

export default App
