import type { Announcements, UniqueIdentifier } from '@dnd-kit/core'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import type { BoardOrder } from '@/api/workshop'

export const WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID = '__unassigned__'

/**
 * Screen-reader messages for board drags. dnd-kit's defaults read out raw ids, so these name the
 * order number and the column (mechanic, bay or Unassigned) instead.
 */
export function createWorkshopBoardAnnouncements(
  orders: BoardOrder[],
  columns: Array<{ id: string; label: string }>,
  viewMode: BoardViewMode,
): Announcements {
  const resourceNoun = viewMode === 'mechanic' ? 'mechanic' : 'bay'
  const orderLabel = (id: UniqueIdentifier) =>
    orders.find((order) => order.id === String(id))?.orderNumber ?? 'Workshop order'
  const columnLabel = (id: UniqueIdentifier) => {
    const column = columns.find((candidate) => candidate.id === String(id))
    if (!column) return 'an unknown column'
    return column.id === WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID
      ? 'Unassigned'
      : `${resourceNoun} ${column.label}`
  }

  return {
    onDragStart: ({ active }) => `Picked up ${orderLabel(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${orderLabel(active.id)} is over ${columnLabel(over.id)}.`
        : `${orderLabel(active.id)} is no longer over a column.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${orderLabel(active.id)} was dropped on ${columnLabel(over.id)}.`
        : `${orderLabel(active.id)} was dropped outside a column and not moved.`,
    onDragCancel: ({ active }) => `Dragging was cancelled. ${orderLabel(active.id)} was not moved.`,
  }
}
