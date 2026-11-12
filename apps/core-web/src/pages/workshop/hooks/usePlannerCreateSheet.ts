import * as React from 'react'
import type { PlannerCreatePrefill } from '@/components/workshop/planner/PlannerCreateSheet'
import { buildPlannerCreatePrefill } from '@/features/workshop/planner/planner-create-prefill'
import type { components } from '@/api/generated/openapi'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']

export function usePlannerCreateSheet(params: {
  openings: WorkshopOpeningHour[]
  holidays: PlannerHoliday[]
  plannerTimezone: string
}) {
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createPrefill, setCreatePrefill] = React.useState<PlannerCreatePrefill | null>(null)

  const openCreateSheet = React.useCallback(
    (bayId: string, startIso: string, endIso?: string) => {
      setCreatePrefill(
        buildPlannerCreatePrefill({
          bayId,
          startIso,
          endIso,
          openings: params.openings,
          holidays: params.holidays,
          timezone: params.plannerTimezone,
        }),
      )
      setCreateOpen(true)
    },
    [params.holidays, params.openings, params.plannerTimezone],
  )

  const handleDaySlotClick = React.useCallback(
    (bayId: string, startIso: string) => {
      openCreateSheet(bayId, startIso)
    },
    [openCreateSheet],
  )

  const handleWeekDayClick = React.useCallback(
    (bayId: string, _date: string, startIso: string) => {
      openCreateSheet(bayId, startIso)
    },
    [openCreateSheet],
  )

  const openBlankCreate = React.useCallback(() => {
    setCreatePrefill(null)
    setCreateOpen(true)
  }, [])

  return {
    createOpen,
    setCreateOpen,
    createPrefill,
    setCreatePrefill,
    handleDaySlotClick,
    handleWeekDayClick,
    openBlankCreate,
  }
}
