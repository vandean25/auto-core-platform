import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthSession } from '@/api/auth-session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { formatPercent } from '@/lib/format'
import { useLazyNamespaceBundleReady } from '@/lib/i18n'

const REPORT_ROLES = ['OWNER', 'ADMIN', 'SALES']

function monthRange(offset: number) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { from: format(start), to: format(end) }
}

function percentage(value: string | null | undefined) {
  return value == null ? '—' : formatPercent(Number(value))
}

export function WorkshopKpiDashboardWidget() {
  const bundleStatus = useLazyNamespaceBundleReady(['workshop'])
  const { t } = useTranslation('workshop')
  const sites = useMySites()
  const session = useAuthSession()
  const siteId = session.data?.activeSiteId ?? sites.data?.[0]?.id ?? ''
  const canReadReport = REPORT_ROLES.includes(session.data?.activeRole ?? '')
  const current = useWorkshopKpiReport({ siteId, ...monthRange(0), groupBy: 'mechanic' }, canReadReport)
  const previous = useWorkshopKpiReport({ siteId, ...monthRange(-1), groupBy: 'mechanic' }, canReadReport)

  if (!canReadReport || bundleStatus !== 'ready') {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('kpi.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {current.isLoading ? (
          <p className="text-sm text-slate-500">{t('kpi.loading')}</p>
        ) : current.data ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-slate-500">{t('kpi.utilisation')}</p>
              <p className="font-semibold">
                {percentage(current.data.totals.utilisation_percent)}{' '}
                <span className="text-xs font-normal text-slate-500">
                  {t('kpi.previousMonth', { value: percentage(previous.data?.totals.utilisation_percent) })}
                </span>
              </p>
            </div>
            <div>
              <p className="text-slate-500">{t('kpi.productivity')}</p>
              <p className="font-semibold">
                {percentage(current.data.totals.productivity_percent)}{' '}
                <span className="text-xs font-normal text-slate-500">
                  {t('kpi.previousMonth', { value: percentage(previous.data?.totals.productivity_percent) })}
                </span>
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t('kpi.empty')}</p>
        )}
        <Link
          to="/workshop/reports/kpis"
          className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('kpi.reportLink')}
        </Link>
      </CardContent>
    </Card>
  )
}
