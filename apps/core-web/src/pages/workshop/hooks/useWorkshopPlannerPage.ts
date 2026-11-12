import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { usePlannerCreateSheet } from './usePlannerCreateSheet'
import { usePlannerDragAndDrop } from './usePlannerDragAndDrop'
import { usePlannerPendingReschedule } from './usePlannerPendingReschedule'
import { usePlannerViewMode } from './usePlannerViewMode'
import { useWorkshopPlannerQuery } from './useWorkshopPlannerQuery'

export function useWorkshopPlannerPage() {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const [viewMode, setViewMode] = usePlannerViewMode()
  const query = useWorkshopPlannerQuery(viewMode)
  const { performReschedule, pendingMoves } = usePlannerPendingReschedule(t)

  const createSheet = usePlannerCreateSheet({
    openings: query.openings,
    holidays: query.holidays,
    plannerTimezone: query.plannerTimezone,
  })

  const drag = usePlannerDragAndDrop({
    bookings: query.bookings,
    openings: query.openings,
    holidays: query.holidays,
    plannerTimezone: query.plannerTimezone,
    performReschedule,
  })

  return {
    t,
    navigate,
    viewMode,
    setViewMode,
    pendingMoves,
    createSheet,
    drag,
    ...query,
  }
}
