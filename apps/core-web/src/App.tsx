import InventoryList from './pages/InventoryList'
import { GlobalSearch } from './components/GlobalSearch'

function App() {
  return (
    <div className="min-h-screen bg-slate-50/30">
      <GlobalSearch />
      <main className="py-10">
        <InventoryList />
      </main>
    </div>
  )
}

export default App
