import { DashboardWidgetsGrid } from '@/features/dashboard-widgets/DashboardWidgetsGrid'
import { dashboardWidgetSourcesByKey } from '@/features/dashboard-widgets/sources'

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-slate-500">Build your command center from saved table filters.</p>
        </div>
      </div>

      <DashboardWidgetsGrid sourcesByKey={dashboardWidgetSourcesByKey} />
    </div>
  )
}
