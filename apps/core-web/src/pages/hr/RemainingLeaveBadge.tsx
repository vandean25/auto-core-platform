import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status/StatusBadge'
import { formatNumber } from '@/lib/format'
import {
  approxLeaveDays,
  averageExpectedMinutesPerWorkday,
  FALLBACK_AVG_WORKDAY_MINUTES,
  type WorkScheduleDayLike,
} from '@/lib/hr-leave-minutes'

type QueryState<T> = { data?: T; isLoading: boolean; isSuccess?: boolean }

type RemainingLeaveBadgeProps = {
  hrMe: QueryState<{ remainingLeaveMinutes: number }>
  myLeave: QueryState<{ remainingMinutes: number }>
  schedule: QueryState<{ current: { days: WorkScheduleDayLike[] } | null }>
}

/** Average workday of the loaded schedule; 0 (unknown) while it is missing, so no number is based on a guess. */
function averageWorkdayMinutes(schedule: RemainingLeaveBadgeProps['schedule']): number {
  if (!schedule.isSuccess) return 0
  const current = schedule.data?.current
  return current ? averageExpectedMinutesPerWorkday(current.days) : FALLBACK_AVG_WORKDAY_MINUTES
}

/**
 * Remaining leave in working days ("Rest: ≈ 25 Tage"), exact minutes in the tooltip. Nothing is shown until the
 * profile, the leave balance and the work schedule are loaded, so the number does not change afterwards; without
 * a schedule the chip falls back to minutes.
 */
export function RemainingLeaveBadge({ hrMe, myLeave, schedule }: RemainingLeaveBadgeProps) {
  const { t } = useTranslation('hr')
  if (hrMe.isLoading || myLeave.isLoading || schedule.isLoading) return null

  const minutes = myLeave.data?.remainingMinutes ?? hrMe.data?.remainingLeaveMinutes ?? 0
  const days = approxLeaveDays(minutes, averageWorkdayMinutes(schedule))
  const exact = t('leave.remainingMinutes', { minutes })
  const label =
    days === null ? exact : t('leave.remaining', { count: days, days: formatNumber(days, { maximumFractionDigits: 1 }) })

  return (
    <span title={exact}>
      <StatusBadge status='ACTIVE' label={label} />
    </span>
  )
}
