import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { DashboardWidgetsGrid } from '@/features/dashboard-widgets/DashboardWidgetsGrid'
import { dashboardWidgetSourcesByKey } from '@/features/dashboard-widgets/sources'
import { OnboardingChecklist } from '@/features/onboarding-checklist/OnboardingChecklist'
import { DashboardKpiRow } from '@/components/dashboard/DashboardKpiRow'

export default function DashboardPage() {
  const { t } = useTranslation('common')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicles')
  }, [])
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
          <p className="text-slate-500">{t('dashboard.description')}</p>
        </div>
      </div>

      <OnboardingChecklist />

      <DashboardKpiRow />

      <DashboardWidgetsGrid sourcesByKey={dashboardWidgetSourcesByKey} />
    </div>
  )
}
