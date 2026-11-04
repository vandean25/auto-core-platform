import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatCurrency } from '@/lib/format'
import { useLazyNamespaceBundleReady } from '@/lib/i18n'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useVehicleStockAgeReport } from '@/api/vehicle-stock'
import { Skeleton } from '@/components/ui/skeleton'

function AgedStockDashboardWidgetContent() {
  const { t } = useTranslation('vehicles')
  const navigate = useNavigate()
  const { data, isLoading } = useVehicleStockAgeReport({ bucket: 'over_90', page: 1, limit: 1 })

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => navigate('/vehicle-stock/reports?bucket=over_90')}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') navigate('/vehicle-stock/reports?bucket=over_90')
      }}
      role="link"
      tabIndex={0}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{t('dashboardWidgets.agedStockTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">
          {isLoading ? <Skeleton className="h-9 w-12" /> : data?.summary.over_90_count ?? 0}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('dashboardWidgets.agedStockCostBasis', { amount: formatCurrency(data?.summary.over_90_cost_basis ?? '0.00') })}
        </p>
      </CardContent>
    </Card>
  )
}

export function AgedStockDashboardWidget() {
  const { status: bundleStatus } = useLazyNamespaceBundleReady(['vehicles'])
  if (bundleStatus !== 'ready') {
    return null
  }
  return <AgedStockDashboardWidgetContent />
}
