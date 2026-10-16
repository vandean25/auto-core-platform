import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'

export const WORKSHOP_BOARD_VIEW_MODE_KEY = 'workshop-board-view-mode'

export function readWorkshopBoardViewMode(): BoardViewMode {
  try {
    const stored = window.localStorage.getItem(WORKSHOP_BOARD_VIEW_MODE_KEY)
    if (stored === 'mechanic' || stored === 'bay') return stored
  } catch {
    // ignore
  }
  return 'mechanic'
}
