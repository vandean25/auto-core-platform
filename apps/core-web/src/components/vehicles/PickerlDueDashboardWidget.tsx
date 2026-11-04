import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLazyNamespaceBundleReady } from '@/lib/i18n'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePickerlDueList } from '@/api/vehicles'
import { Skeleton } from '@/components/ui/skeleton'

function PickerlDueDashboardWidgetContent({ window }: { window: 30 | 60 | 90 }) {
  const { t } = useTranslation('vehicles')
  const navigate = useNavigate()
  const { data, isLoading } = usePickerlDueList({ window, page: 1, pageSize: 1 })

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => navigate(`/vehicles/pickerl-due?filter_window=${window}`)}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t('dashboardWidgets.pickerlDueTitle', { count: window })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">
          {isLoading ? (
            <Skeleton className="h-9 w-12" />
          ) : (
            data?.meta?.total ?? 0
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function PickerlDueDashboardWidget({ window }: { window: 30 | 60 | 90 }) {
  const { status: bundleStatus } = useLazyNamespaceBundleReady(['vehicles'])
  if (bundleStatus !== 'ready') {
    return null
  }
  return <PickerlDueDashboardWidgetContent window={window} />
}
