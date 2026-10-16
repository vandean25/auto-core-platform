import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import type { BoardAssignmentTarget } from '@/api/workshop'
import { WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID } from './workshop-board-announcements'

export function createWorkshopBoardDragHandlers(
  viewMode: BoardViewMode,
  setActiveId: (id: string | null) => void,
  performBoardAssign: (orderId: string, target: BoardAssignmentTarget | null) => void,
) {
  return {
    onDragStart(event: DragStartEvent) {
      setActiveId(String(event.active.id))
    },
    onDragEnd(event: DragEndEvent) {
      setActiveId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const orderId = String(active.id)
      const targetColumnId = String(over.id)
      if (targetColumnId === WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID) {
        performBoardAssign(orderId, null)
        return
      }

      performBoardAssign(orderId, {
        kind: viewMode === 'mechanic' ? 'mechanic' : 'bay',
        id: targetColumnId,
        label: targetColumnId,
      })
    },
  }
}
