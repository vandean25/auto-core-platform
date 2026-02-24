import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import { Settings, Search } from 'lucide-react'
import InventoryList from './pages/InventoryList'
import VendorList from './pages/vendors/VendorList'
import PurchaseOrderList from './pages/purchase-orders/PurchaseOrderList'
import PurchaseOrderCreate from './pages/purchase-orders/PurchaseOrderCreate'
import PurchaseOrderDetail from './pages/purchase-orders/PurchaseOrderDetail'
import InvoiceCreatePage from './pages/sales/InvoiceCreatePage'
import PurchaseInvoiceCreatePage from './pages/purchase-invoices/PurchaseInvoiceCreatePage'
import SettingsPage from './pages/SettingsPage'
import DashboardPage from './pages/DashboardPage'
import { IntakeDashboard } from './pages/workshop/IntakeDashboard'
import { GlobalSearch } from './components/GlobalSearch'
import CustomerList from './pages/customers/CustomerList'
import CustomerDetail from './pages/customers/CustomerDetail'
import SalesOrderList from './pages/sales-orders/SalesOrderList'
import SalesOrderCreate from './pages/sales-orders/SalesOrderCreate'
import SalesOrderDetail from './pages/sales-orders/SalesOrderDetail'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import * as React from 'react'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "text-sm font-medium transition-colors px-3 py-1.5 rounded-md",
    isActive
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:text-foreground hover:bg-accent"
  )

function App() {
  const [searchOpen, setSearchOpen] = React.useState(false)

  // Listen for Ctrl/Cmd+K globally
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <Router>
      <div className="min-h-screen bg-slate-50/30">
        <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="container mx-auto px-4 h-14 flex items-center justify-between">
            {/* Left: Logo + Navigation */}
            <div className="flex items-center gap-6">
              <NavLink to="/dashboard" className="font-bold text-lg tracking-tight text-primary whitespace-nowrap">
                Auto Core
              </NavLink>

              <div className="h-5 w-px bg-border" />

              <nav className="flex items-center gap-1">
                <NavLink to="/dashboard" className={navLinkClass} end>Dashboard</NavLink>

                {/* Sales group */}
                <div className="h-4 w-px bg-border mx-1" />
                <NavLink to="/customers" className={navLinkClass}>Customers</NavLink>
                <NavLink to="/sales-orders" className={navLinkClass}>Sales</NavLink>

                {/* Inventory */}
                <div className="h-4 w-px bg-border mx-1" />
                <NavLink to="/" className={navLinkClass} end>Inventory</NavLink>

                {/* Procurement group */}
                <div className="h-4 w-px bg-border mx-1" />
                <NavLink to="/vendors" className={navLinkClass}>Vendors</NavLink>
                <NavLink to="/purchase-orders" className={navLinkClass}>Purchase Orders</NavLink>

                {/* Workshop */}
                <div className="h-4 w-px bg-border mx-1" />
                <NavLink to="/workshop/intake" className={navLinkClass}>Workshop</NavLink>
              </nav>
            </div>

            {/* Right: Search + Settings */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-3 py-1.5 hover:bg-accent transition-colors"
              >
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">Search</span>
                <kbd className="hidden sm:inline pointer-events-none select-none rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {navigator.userAgent.includes('Mac') ? '⌘K' : 'Ctrl+K'}
                </kbd>
              </button>

              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  cn(
                    "p-2 rounded-md transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )
                }
                title="Settings"
              >
                <Settings className="h-5 w-5" />
              </NavLink>
            </div>
          </div>
        </header>

        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />

        <main className="container mx-auto py-8 px-4">
          <Routes>
            <Route path="/" element={<InventoryList />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/customers" element={<CustomerList />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/sales-orders" element={<SalesOrderList />} />
            <Route path="/sales-orders/new" element={<SalesOrderCreate />} />
            <Route path="/sales-orders/:id" element={<SalesOrderDetail />} />
            <Route path="/vendors" element={<VendorList />} />
            <Route path="/purchase-orders" element={<PurchaseOrderList />} />
            <Route path="/purchase-orders/new" element={<PurchaseOrderCreate />} />
            <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
            <Route path="/sales/invoices/new" element={<InvoiceCreatePage />} />
            <Route path="/purchase-invoices/new" element={<PurchaseInvoiceCreatePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/workshop/intake" element={<IntakeDashboard />} />
          </Routes>
          <Toaster />
        </main>
      </div>
    </Router>
  )
}

export default App
