import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  initialPlannerAnchorDate,
  isPlannerDateSearchParam,
} from '@/features/workshop/planner/planner-anchor-date'
import { addLocalDays, formatLocalDate } from '@/features/workshop/planner/planner-time'

export function usePlannerAnchorDate(settingsTimezone: string | undefined) {
  const [searchParams] = useSearchParams()
  const dateParam = searchParams.get('date')
  const defaultTimezone = settingsTimezone ?? 'Europe/Vienna'

  const [anchorDate, setAnchorDate] = React.useState(() =>
    initialPlannerAnchorDate(dateParam, defaultTimezone),
  )

  React.useEffect(() => {
    if (isPlannerDateSearchParam(dateParam)) {
      setAnchorDate(dateParam)
    }
  }, [dateParam])

  React.useEffect(() => {
    if (settingsTimezone && !dateParam) {
      setAnchorDate(formatLocalDate(new Date(), settingsTimezone))
    }
  }, [settingsTimezone, dateParam])

  const shiftAnchor = React.useCallback((days: number) => {
    setAnchorDate((current) => addLocalDays(current, days))
  }, [])

  return { anchorDate, shiftAnchor }
}
