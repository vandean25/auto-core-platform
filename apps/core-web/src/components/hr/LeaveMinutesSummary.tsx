import type * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { formatApproxDays } from '@/lib/hr-leave-minutes'
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

  const approx = formatApproxDays(minutes, avgMinutesPerWorkday)
  return (
    <span>
      {t('leaveMinutes.min', { count: minutes })}
      {approx ? <span className='text-slate-500'> ({approx})</span> : null}
    </span>
  )
}
