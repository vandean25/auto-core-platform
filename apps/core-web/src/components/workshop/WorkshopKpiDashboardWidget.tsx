import { Link } from 'react-router-dom'
import { useAuthSession } from '@/api/auth-session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport } from '@/api/workshop-kpi-reports'

const REPORT_ROLES = ['OWNER', 'ADMIN', 'SALES']

function monthRange(offset: number) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { from: format(start), to: format(end) }
}

function percentage(value: string | null | undefined) {
  return value == null ? '—' : `${Number(value).toLocaleString('de-AT', { maximumFractionDigits: 1 })} %`
}

export function WorkshopKpiDashboardWidget() {
  const sites = useMySites()
  const session = useAuthSession()
  const siteId = session.data?.activeSiteId ?? sites.data?.[0]?.id ?? ''
  const canReadReport = REPORT_ROLES.includes(session.data?.activeRole ?? '')
  const current = useWorkshopKpiReport({ siteId, ...monthRange(0), groupBy: 'mechanic' }, canReadReport)
  const previous = useWorkshopKpiReport({ siteId, ...monthRange(-1), groupBy: 'mechanic' }, canReadReport)

  if (!canReadReport) return null

  return <Card><CardHeader><CardTitle>Workshop diesen Monat</CardTitle></CardHeader><CardContent>
    {current.isLoading ? <p className="text-sm text-slate-500">Wird geladen …</p> : current.data ? <div className="grid grid-cols-2 gap-3 text-sm">
      <div><p className="text-slate-500">Auslastung</p><p className="font-semibold">{percentage(current.data.totals.utilisation_percent)} <span className="text-xs font-normal text-slate-500">(Vormonat {percentage(previous.data?.totals.utilisation_percent)})</span></p></div>
      <div><p className="text-slate-500">Leistungsgrad</p><p className="font-semibold">{percentage(current.data.totals.productivity_percent)} <span className="text-xs font-normal text-slate-500">(Vormonat {percentage(previous.data?.totals.productivity_percent)})</span></p></div>
    </div> : <p className="text-sm text-slate-500">Noch keine Workshop-Daten für diesen Monat.</p>}
    <Link to="/workshop/reports/kpis" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">Zum Workshop-Bericht</Link>
  </CardContent></Card>
}
