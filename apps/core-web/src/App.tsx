import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import InventoryList from './pages/InventoryList'
import VendorList from './pages/vendors/VendorList'
import PurchaseOrderList from './pages/purchase-orders/PurchaseOrderList'
import PurchaseOrderCreate from './pages/purchase-orders/PurchaseOrderCreate'
import PurchaseOrderDetail from './pages/purchase-orders/PurchaseOrderDetail'
import InvoiceCreatePage from './pages/sales/InvoiceCreatePage'
import PurchaseInvoiceCreatePage from './pages/purchase-invoices/PurchaseInvoiceCreatePage'
import FinanceSettingsPage from './pages/FinanceSettingsPage'
import DashboardPage from './pages/DashboardPage'
import { GlobalSearch } from './components/GlobalSearch'
import { Toaster } from '@/components/ui/sonner'

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-50/30">
        <header className="border-b bg-white sticky top-0 z-10">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-8">
              <Link to="/dashboard" className="font-bold text-xl text-primary">Auto Core Platform</Link>
              <nav className="flex space-x-6">
                <Link to="/dashboard" className="text-sm font-medium hover:text-primary transition-colors">Dashboard</Link>
                <Link to="/" className="text-sm font-medium hover:text-primary transition-colors">Inventory</Link>
                <Link to="/vendors" className="text-sm font-medium hover:text-primary transition-colors">Vendors</Link>
                <Link to="/purchase-orders" className="text-sm font-medium hover:text-primary transition-colors">Purchase Orders</Link>
                <Link to="/sales/invoices/new" className="text-sm font-medium hover:text-primary transition-colors">New Invoice</Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
               <Link to="/finance/settings" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Finance Settings</Link>
            </div>
          </div>
        </header>

        <GlobalSearch />

        <main className="container mx-auto py-10 px-4">
          <Routes>
            <Route path="/" element={<InventoryList />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/vendors" element={<VendorList />} />
            <Route path="/purchase-orders" element={<PurchaseOrderList />} />
            <Route path="/purchase-orders/new" element={<PurchaseOrderCreate />} />
            <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
            <Route path="/sales/invoices/new" element={<InvoiceCreatePage />} />
            <Route path="/purchase-invoices/new" element={<PurchaseInvoiceCreatePage />} />
            <Route path="/finance/settings" element={<FinanceSettingsPage />} />
          </Routes>
          <Toaster />
        </main>
      </div>
    </Router>
  )
}

export default App
