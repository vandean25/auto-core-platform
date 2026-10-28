import type * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { formatNumber } from '@/lib/format'
import { approxLeaveDays } from '@/lib/hr-leave-minutes'
import { ensureNamespaceLoaded } from '@/lib/i18n'

export type LeaveMinutesSummaryProps = {
  minutes: number
  avgMinutesPerWorkday: number
}

export function LeaveMinutesSummary({
  minutes,
  avgMinutesPerWorkday,
}: LeaveMinutesSummaryProps): React.JSX.Element {
  const { t } = useTranslation('hr')
  useEffect(() => {
    void ensureNamespaceLoaded('hr')
  }, [])

  const days = approxLeaveDays(minutes, avgMinutesPerWorkday)
  return (
    <span>
      {t('leaveMinutes.min', { count: minutes })}
      {days !== null ? <span className='text-slate-500'> ({t('leaveMinutes.approx', { days: formatNumber(days, { maximumFractionDigits: 1 }) })})</span> : null}
    </span>
  )
}
