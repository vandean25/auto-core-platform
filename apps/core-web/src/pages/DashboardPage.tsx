import { DashboardWidgetsGrid } from '@/features/dashboard-widgets/DashboardWidgetsGrid'
import { dashboardWidgetSourcesByKey } from '@/features/dashboard-widgets/sources'
import { PickerlDueDashboardWidget } from '@/components/vehicles/PickerlDueDashboardWidget'

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-slate-500">Build your command center from saved table filters.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
        <PickerlDueDashboardWidget window={30} />
        <PickerlDueDashboardWidget window={60} />
        <PickerlDueDashboardWidget window={90} />
      </div>

      <DashboardWidgetsGrid sourcesByKey={dashboardWidgetSourcesByKey} />
    </div>
  )
}
