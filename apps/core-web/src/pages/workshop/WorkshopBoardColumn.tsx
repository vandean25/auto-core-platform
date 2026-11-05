import { useDroppable } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { WorkshopOrderCard } from '@/components/workshop/WorkshopOrderCard'
import type { BoardAssignmentTarget, BoardOrder } from '@/api/workshop'
import { WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID } from './workshop-board-announcements'
import { workshopBoardColumnClassName } from './workshop-board-column-styles'

export function WorkshopBoardColumn({
  id,
  label,
  orders,
  activeId,
  quickAssignTargets,
  onQuickAssign,
}: {
  id: string
  label: string
  orders: BoardOrder[]
  activeId: string | null
  quickAssignTargets: BoardAssignmentTarget[]
  onQuickAssign: (orderId: string, target: BoardAssignmentTarget) => void
}) {
  const { t } = useTranslation('workshop')
  const { isOver, setNodeRef } = useDroppable({ id })

  const isDragging = activeId !== null
  return (
    <div
      ref={setNodeRef}
      data-testid={`board-column-${id === WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID ? 'unassigned' : id}`}
      className={`${workshopBoardColumnClassName} ${
        isOver ? 'border-muted-foreground/60 bg-muted' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-xs font-medium rounded-full bg-border text-muted-foreground px-2 py-0.5 tabular-nums">
          {orders.length}
        </span>
      </div>

      <div className="flex flex-col gap-2 p-2 min-h-24">
        {orders.map((order) => (
          <WorkshopOrderCard
            key={order.id}
            order={order}
            isPlaceholder={order.id === activeId}
            quickAssignTargets={quickAssignTargets}
            onQuickAssign={(target) => onQuickAssign(order.id, target)}
          />
        ))}
        {orders.length === 0 && isDragging && isOver && (
          <div
            data-testid="board-drop-slot"
            aria-hidden="true"
            className="h-20 rounded-md border-2 border-dashed border-muted-foreground/40"
          />
        )}
        {orders.length === 0 && !(isDragging && isOver) && (
          <p className="text-xs text-muted-foreground text-center mt-4">{t('board.emptyColumn')}</p>
        )}
      </div>
    </div>
  )
}
