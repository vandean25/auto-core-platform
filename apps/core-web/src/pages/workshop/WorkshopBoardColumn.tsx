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

  const visibleOrders = orders.filter((order) => order.id !== activeId)

  return (
    <div
      ref={setNodeRef}
      data-testid={`board-column-${id === WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID ? 'unassigned' : id}`}
      className={`${workshopBoardColumnClassName} ${
        isOver ? 'border-slate-400 bg-slate-100' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-xs font-medium rounded-full bg-slate-200 text-slate-600 px-2 py-0.5 tabular-nums">
          {visibleOrders.length}
        </span>
      </div>

      <div className="flex flex-col gap-2 p-2 min-h-24">
        {visibleOrders.map((order) => (
          <WorkshopOrderCard
            key={order.id}
            order={order}
            quickAssignTargets={quickAssignTargets}
            onQuickAssign={(target) => onQuickAssign(order.id, target)}
          />
        ))}
        {visibleOrders.length === 0 && (
          <p className="text-xs text-slate-500 text-center mt-4">{t('board.emptyColumn')}</p>
        )}
      </div>
    </div>
  )
}
