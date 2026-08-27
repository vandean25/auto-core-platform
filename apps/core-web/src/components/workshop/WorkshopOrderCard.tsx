import { useDraggable } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import { StatusBadge, formatStatusLabel } from '@/components/status/StatusBadge'
import { cn } from '@/lib/utils'
import type {
  BoardAssignmentTarget,
  BoardOrder,
  PartsStatus,
} from '@/api/workshop'

interface WorkshopOrderCardContentProps {
  order: BoardOrder
  isDragging?: boolean
  quickAssignTargets?: BoardAssignmentTarget[]
  onQuickAssign?: (target: BoardAssignmentTarget) => void
  setNodeRef?: (element: HTMLElement | null) => void
  dragAttributes?: ReturnType<typeof useDraggable>['attributes']
  dragListeners?: ReturnType<typeof useDraggable>['listeners']
}

const partsStatusBorder: Record<PartsStatus, string> = {
  READY: 'border-l-emerald-500',
  SHORTAGE: 'border-l-rose-500',
  WAITING: 'border-l-amber-500',
  NO_PARTS: 'border-l-slate-300',
}

function getCustomerName(order: BoardOrder): string {
  if (!order.customer) return 'Dealer stock'
  if (order.customer.type === 'COMPANY' && order.customer.companyName) {
    return order.customer.companyName
  }
  return `${order.customer.firstName ?? ''} ${order.customer.lastName ?? ''}`.trim()
}

export function WorkshopOrderCardContent({
  order,
  isDragging = false,
  quickAssignTargets = [],
  onQuickAssign,
  setNodeRef,
  dragAttributes,
  dragListeners,
}: WorkshopOrderCardContentProps) {
  const borderColor = partsStatusBorder[order.partsStatus]

  return (
    <div
      ref={setNodeRef}
      data-testid={`workshop-order-card-${order.id}`}
      className={cn(
        'relative rounded-md border bg-white shadow-sm border-l-4 p-3 cursor-grab active:cursor-grabbing select-none transition-shadow',
        borderColor,
        isDragging && 'shadow-lg ring-2 ring-slate-300',
      )}
      {...dragAttributes}
      {...dragListeners}
    >
      {/* Drag handle visual */}
      <div className="absolute top-2 right-2 text-slate-300 pointer-events-none">
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Order number */}
      <p className="text-xs font-mono text-slate-500 mb-1">{order.orderNumber}</p>

      {/* Customer */}
      <p className="text-sm font-semibold text-slate-900 truncate pr-5 leading-snug">
        {getCustomerName(order)}
      </p>

      {/* Vehicle */}
      <p className="text-xs text-slate-500 truncate mt-0.5">
        {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
        {order.vehicle.plate && (
          <span className="ml-1 font-medium text-slate-600">· {order.vehicle.plate}</span>
        )}
      </p>

      {/* Badges */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <StatusBadge status={order.status} label={formatStatusLabel(order.status)} />
        <StatusBadge
          status={order.partsStatus}
          label={formatStatusLabel(order.partsStatus)}
        />
      </div>

      {quickAssignTargets.length > 0 ? (
        <div className="sr-only">
          {quickAssignTargets.map((target) => (
            <button
              key={`${target.kind}-${target.id}`}
              type="button"
              data-testid={`assign-${target.kind}-${target.id}`}
              aria-label={`Assign to ${target.label}`}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onQuickAssign?.(target)
              }}
            >
              Assign to {target.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface WorkshopOrderCardProps {
  order: BoardOrder
  quickAssignTargets?: BoardAssignmentTarget[]
  onQuickAssign?: (target: BoardAssignmentTarget) => void
}

export function WorkshopOrderCard({
  order,
  quickAssignTargets = [],
  onQuickAssign,
}: WorkshopOrderCardProps) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: order.id })

  return (
    <WorkshopOrderCardContent
      order={order}
      quickAssignTargets={quickAssignTargets}
      onQuickAssign={onQuickAssign}
      setNodeRef={setNodeRef}
      dragAttributes={attributes}
      dragListeners={listeners}
    />
  )
}

export function WorkshopOrderCardOverlay({ order }: { order: BoardOrder }) {
  return <WorkshopOrderCardContent order={order} isDragging />
}
