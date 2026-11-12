import * as React from 'react'
import type { PlannerViewMode } from '@/components/workshop/planner/PlannerViewToggle'
import {
  persistPlannerViewMode,
  readPlannerViewMode,
} from '@/features/workshop/planner/planner-view-mode'

export function usePlannerViewMode(): [PlannerViewMode, (mode: PlannerViewMode) => void] {
  const [viewMode, setViewMode] = React.useState<PlannerViewMode>(readPlannerViewMode)

  React.useEffect(() => {
    persistPlannerViewMode(viewMode)
  }, [viewMode])

  return [viewMode, setViewMode]
}
