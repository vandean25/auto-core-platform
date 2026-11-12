import type { PlannerViewMode } from '@/components/workshop/planner/PlannerViewToggle'

export const PLANNER_VIEW_MODE_STORAGE_KEY = 'workshop-planner-view'

export function readPlannerViewMode(): PlannerViewMode {
  try {
    const stored = window.localStorage.getItem(PLANNER_VIEW_MODE_STORAGE_KEY)
    if (stored === 'day' || stored === 'week') return stored
  } catch {
    // ignore
  }
  return 'day'
}

export function persistPlannerViewMode(mode: PlannerViewMode): void {
  try {
    window.localStorage.setItem(PLANNER_VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}
