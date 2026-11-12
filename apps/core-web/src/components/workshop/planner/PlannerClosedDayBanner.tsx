import { Calendar } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { EffectiveHours } from '@/features/workshop/planner/planner-hours'
import { PlannerEmptyState } from './PlannerEmptyState'

export function PlannerClosedDayBanner({
  dayHours,
  t,
  onGoToHoursSettings,
}: {
  dayHours: EffectiveHours | null
  t: TFunction<'workshop'>
  onGoToHoursSettings: () => void
}) {
  return (
    <PlannerEmptyState
      icon={<Calendar aria-hidden />}
      title={
        dayHours?.holidayName
          ? t('planner.grid.closedWithHoliday', { name: dayHours.holidayName })
          : t('planner.page.closedTitle')
      }
      description={t('planner.page.closedDescription')}
      onGoToSettings={onGoToHoursSettings}
    />
  )
}
