import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useVehicleStockAgeReport } from '@/api/vehicle-stock'
import { Loader2 } from 'lucide-react'

function formatEuro(value: string) {
  const [whole, fraction = '00'] = value.split('.')
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${groupedWhole},${fraction}\u00a0€`
}

export function AgedStockDashboardWidget() {
  const navigate = useNavigate()
  const { data, isLoading } = useVehicleStockAgeReport({ bucket: 'over_90', page: 1, limit: 1 })

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-slate-50"
      onClick={() => navigate('/vehicle-stock/reports?bucket=over_90')}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') navigate('/vehicle-stock/reports?bucket=over_90')
      }}
      role="link"
      tabIndex={0}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">Aged stock · über 90 Tage</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">
          {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-slate-400" /> : data?.summary.over_90_count ?? 0}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Kostenbasis {formatEuro(data?.summary.over_90_cost_basis ?? '0.00')}
        </p>
      </CardContent>
    </Card>
  )
}
