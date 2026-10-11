import { AgedStockDashboardWidget } from '@/components/vehicles/AgedStockDashboardWidget'
import { PickerlDueDashboardWidget } from '@/components/vehicles/PickerlDueDashboardWidget'
import { WorkshopKpiDashboardWidget } from '@/components/workshop/WorkshopKpiDashboardWidget'

const PICKERL_DUE_WINDOWS = [30, 60, 90] as const

export function DashboardKpiRow() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
      {PICKERL_DUE_WINDOWS.map((windowDays) => (
        <PickerlDueDashboardWidget key={windowDays} window={windowDays} />
      ))}
      <AgedStockDashboardWidget />
      <WorkshopKpiDashboardWidget />
    </div>
  )
}
