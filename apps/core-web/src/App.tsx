import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import InventoryList from './pages/InventoryList'
import VendorList from './pages/vendors/VendorList'
import PurchaseOrderList from './pages/purchase-orders/PurchaseOrderList'
import PurchaseOrderCreate from './pages/purchase-orders/PurchaseOrderCreate'
import PurchaseOrderDetail from './pages/purchase-orders/PurchaseOrderDetail'
import InvoiceCreatePage from './pages/sales/InvoiceCreatePage'
import { GlobalSearch } from './components/GlobalSearch'
import { Toaster } from '@/components/ui/sonner'

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-50/30">
        <header className="border-b bg-white sticky top-0 z-10">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="font-bold text-xl text-primary">Auto Core Platform</div>
            <nav className="flex space-x-6">
              <Link to="/" className="text-sm font-medium hover:text-primary transition-colors">Inventory</Link>
              <Link to="/vendors" className="text-sm font-medium hover:text-primary transition-colors">Vendors</Link>
              <Link to="/purchase-orders" className="text-sm font-medium hover:text-primary transition-colors">Purchase Orders</Link>
              <Link to="/sales/invoices/new" className="text-sm font-medium hover:text-primary transition-colors">New Invoice</Link>
            </nav>
          </div>
        </header>

        <GlobalSearch />

        <main className="container mx-auto py-10">
          <Routes>
            <Route path="/" element={<InventoryList />} />
            <Route path="/vendors" element={<VendorList />} />
            <Route path="/purchase-orders" element={<PurchaseOrderList />} />
            <Route path="/purchase-orders/new" element={<PurchaseOrderCreate />} />
            <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
            <Route path="/sales/invoices/new" element={<InvoiceCreatePage />} />
          </Routes>
          <Toaster />
        </main>
      </div>
    </Router>
  )
}

export default App
