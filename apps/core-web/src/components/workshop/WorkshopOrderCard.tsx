import { useDraggable } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import type { SyntheticEvent } from 'react'
import { StatusBadge, formatStatusLabel } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  setActivatorNodeRef?: (element: HTMLElement | null) => void
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

// The pointer and touch sensors start a drag from any element inside the card, so the Assign
// trigger and its menu stop those events before they reach the draggable root.
function stopEventFromStartingDrag(event: SyntheticEvent) {
  event.stopPropagation()
}

export function WorkshopOrderCardContent({
  order,
  isDragging = false,
  quickAssignTargets = [],
  onQuickAssign,
  setNodeRef,
  setActivatorNodeRef,
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
      {...dragListeners}
    >
      {/* Keyboard drag handle. It is a sibling of the Assign control, so no button sits inside another. */}
      {dragAttributes ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Move ${order.orderNumber}`}
          className="absolute top-1 right-1 flex h-11 w-11 min-h-[24px] min-w-[24px] items-center justify-center rounded-sm text-slate-400 cursor-grab hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...dragAttributes}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <div className="absolute top-2 right-2 text-slate-300 pointer-events-none" aria-hidden="true">
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      {/* Order number */}
      <p className="text-xs font-mono text-slate-500 mb-1">{order.orderNumber}</p>

      {/* Customer */}
      <p className="text-sm font-semibold text-slate-900 pr-12 leading-snug break-words">
        {getCustomerName(order)}
      </p>

      {/* Vehicle */}
      <p className="text-xs text-slate-500 break-words mt-0.5">
        {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
        {order.vehicle.plate && (
          <span className="ml-1 font-medium text-slate-600">· {order.vehicle.plate}</span>
        )}
      </p>

      {/* Badges and quick assign */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <StatusBadge status={order.status} label={formatStatusLabel(order.status)} />
        <StatusBadge
          status={order.partsStatus}
          label={formatStatusLabel(order.partsStatus)}
        />
        {quickAssignTargets.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Assign ${order.orderNumber}`}
                className="ml-auto min-h-11 min-w-11 px-3"
                onPointerDown={stopEventFromStartingDrag}
                onTouchStart={stopEventFromStartingDrag}
              >
                Assign
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onPointerDown={stopEventFromStartingDrag}
              onTouchStart={stopEventFromStartingDrag}
            >
              <DropdownMenuLabel>Assign to</DropdownMenuLabel>
              {quickAssignTargets.map((target) => (
                <DropdownMenuItem
                  key={`${target.kind}-${target.id}`}
                  data-testid={`assign-${target.kind}-${target.id}`}
                  onSelect={() => onQuickAssign?.(target)}
                >
                  {target.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
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
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({ id: order.id })

  return (
    <WorkshopOrderCardContent
      order={order}
      quickAssignTargets={quickAssignTargets}
      onQuickAssign={onQuickAssign}
      setNodeRef={setNodeRef}
      setActivatorNodeRef={setActivatorNodeRef}
      dragAttributes={attributes}
      dragListeners={listeners}
    />
  )
}

export function WorkshopOrderCardOverlay({ order }: { order: BoardOrder }) {
  return <WorkshopOrderCardContent order={order} isDragging />
}
