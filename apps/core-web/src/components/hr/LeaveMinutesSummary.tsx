import type * as React from 'react'

import { formatApproxDays } from '@/lib/hr-leave-minutes'

export type LeaveMinutesSummaryProps = {
  minutes: number
  avgMinutesPerWorkday: number
}

export function LeaveMinutesSummary({
  minutes,
  avgMinutesPerWorkday,
}: LeaveMinutesSummaryProps): React.JSX.Element {
  const approx = formatApproxDays(minutes, avgMinutesPerWorkday)
  return (
    <span>
      {minutes} min{approx ? <span className='text-slate-500'> ({approx})</span> : null}
    </span>
  )
}
