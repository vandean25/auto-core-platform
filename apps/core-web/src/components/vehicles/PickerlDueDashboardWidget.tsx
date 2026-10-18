import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePickerlDueList } from '@/api/vehicles'
import { Loader2 } from 'lucide-react'

export function PickerlDueDashboardWidget({ window }: { window: 30 | 60 | 90 }) {
  const { t } = useTranslation('vehicles')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicles')
  }, [])
  const navigate = useNavigate()
  const { data, isLoading } = usePickerlDueList({ window, page: 1, pageSize: 1 })

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-slate-50"
      onClick={() => navigate(`/vehicles/pickerl-due?filter_window=${window}`)}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">
          {t('dashboardWidgets.pickerlDueTitle', { count: window })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          ) : (
            data?.meta?.total ?? 0
          )}
        </div>
      </CardContent>
    </Card>
  )
}
