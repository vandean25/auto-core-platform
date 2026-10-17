import type { Announcements, UniqueIdentifier } from '@dnd-kit/core'
import type { TFunction } from 'i18next'
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
  t: TFunction<'workshop'>,
): Announcements {
  const resourceNoun =
    viewMode === 'mechanic'
      ? t('board.a11y.resourceNoun.mechanic')
      : t('board.a11y.resourceNoun.bay')
  const orderLabel = (id: UniqueIdentifier) =>
    orders.find((order) => order.id === String(id))?.orderNumber ?? t('board.a11y.orderFallback')
  const columnLabel = (id: UniqueIdentifier) => {
    const column = columns.find((candidate) => candidate.id === String(id))
    if (!column) return t('board.a11y.unknownColumn')
    return column.id === WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID
      ? t('board.unassigned')
      : t('board.a11y.resourceColumn', { resource: resourceNoun, label: column.label })
  }

  return {
    onDragStart: ({ active }) => t('board.a11y.pickedUp', { order: orderLabel(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t('board.a11y.overColumn', { order: orderLabel(active.id), column: columnLabel(over.id) })
        : t('board.a11y.notOverColumn', { order: orderLabel(active.id) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t('board.a11y.droppedOn', { order: orderLabel(active.id), column: columnLabel(over.id) })
        : t('board.a11y.droppedOutside', { order: orderLabel(active.id) }),
    onDragCancel: ({ active }) =>
      t('board.a11y.cancelled', { order: orderLabel(active.id) }),
  }
}
