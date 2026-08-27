import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useNavigate } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { HorizontalScrollArea } from '@/components/ui/horizontal-scroll-area'
import { WorkshopOrderCard } from '@/components/workshop/WorkshopOrderCard'
import { BoardViewToggle } from '@/components/workshop/BoardViewToggle'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import {
  type BoardActiveResponse,
  type BoardAssignmentTarget,
  type BoardOrder,
  useBoardActive,
  useWorkshopResources,
  useAssignBoard,
  workshopKeys,
} from '@/api/workshop'

// ─── Local-storage helpers ───────────────────────────────────────────────────

const VIEW_MODE_KEY = 'workshop-board-view-mode'

function readViewMode(): BoardViewMode {
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY)
    if (stored === 'mechanic' || stored === 'bay') return stored
  } catch {
    // ignore
  }
  return 'mechanic'
}

// ─── Droppable Column ─────────────────────────────────────────────────────────

function DroppableColumn({
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
  const { isOver, setNodeRef } = useDroppable({ id })

  const visibleOrders = orders.filter((o) => o.id !== activeId)

  return (
    <div
      ref={setNodeRef}
      data-testid={`board-column-${id === '__unassigned__' ? 'unassigned' : id}`}
      className={`flex flex-col rounded-lg border bg-slate-50 transition-colors min-w-[240px] w-72 flex-shrink-0 ${
        isOver ? 'border-slate-400 bg-slate-100' : 'border-slate-200'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-xs font-medium rounded-full bg-slate-200 text-slate-600 px-2 py-0.5 tabular-nums">
          {visibleOrders.length}
        </span>
      </div>

      {/* Cards */}
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
          <p className="text-xs text-slate-400 text-center mt-4">No orders</p>
        )}
      </div>
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyResourcesCard({ mode }: { mode: BoardViewMode }) {
  const navigate = useNavigate()
  const tab = mode === 'mechanic' ? 'employees' : 'bays'
  const label = mode === 'mechanic' ? 'Mechanics' : 'Bays'

  return (
    <Card className="max-w-sm mx-auto mt-8">
      <CardHeader className="items-center pb-2">
        <div className="rounded-full bg-slate-100 p-3 mb-2">
          <Wrench className="h-6 w-6 text-slate-400" />
        </div>
        <CardTitle className="text-base text-center">No {label} configured</CardTitle>
        <CardDescription className="text-center">
          Add {label.toLowerCase()} in Settings to start assigning workshop orders.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pt-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/settings?tab=${tab}`)}
        >
          Go to Settings
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkshopBoard() {
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = React.useState<BoardViewMode>(readViewMode)
  const [activeId, setActiveId] = React.useState<string | null>(null)

  // Persist view mode
  React.useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode)
    } catch {
      // ignore
    }
  }, [viewMode])

  const { data: resourcesData, isLoading: resourcesLoading } = useWorkshopResources()
  const { data: boardData, isLoading: boardLoading } = useBoardActive()
  const assignBoard = useAssignBoard()

  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor))

  const quickAssignTargets = React.useMemo<BoardAssignmentTarget[]>(() => {
    const mechanicTargets = (resourcesData?.mechanics ?? []).map((mechanic) => ({
      kind: 'mechanic' as const,
      id: mechanic.id,
      label: mechanic.name,
    }))
    const bayTargets = (resourcesData?.bays ?? []).map((bay) => ({
      kind: 'bay' as const,
      id: bay.id,
      label: bay.name,
    }))
    return [...mechanicTargets, ...bayTargets]
  }, [resourcesData])

  const resources = React.useMemo(() =>
    viewMode === 'mechanic'
      ? (resourcesData?.mechanics ?? [])
      : (resourcesData?.bays ?? []), [resourcesData, viewMode])

  const orders = React.useMemo(() => boardData?.data ?? [], [boardData])

  // Build columns: resource columns + always-present Unassigned
  const columns = React.useMemo(() => {
    const resourceCols = resources.map((r) => ({
      id: r.id,
      label: r.name,
      orders: orders.filter((o) =>
        viewMode === 'mechanic' ? o.mechanicId === r.id : o.bayId === r.id,
      ),
    }))

    const unassignedOrders = orders.filter((o) =>
      viewMode === 'mechanic' ? !o.mechanicId : !o.bayId,
    )

    return [
      ...resourceCols,
      { id: '__unassigned__', label: 'Unassigned', orders: unassignedOrders },
    ]
  }, [resources, orders, viewMode])

  const activeOrder = activeId ? orders.find((o) => o.id === activeId) ?? null : null

  const performBoardAssign = React.useCallback(
    (orderId: string, target: BoardAssignmentTarget | null) => {
      const previousData = queryClient.getQueryData<BoardActiveResponse>(
        workshopKeys.boardActive(),
      )

      queryClient.setQueryData<BoardActiveResponse>(workshopKeys.boardActive(), (old) => {
        if (!old) return old

        return {
          ...old,
          data: old.data.map((order) => {
            if (order.id !== orderId) return order

            if (target?.kind === 'mechanic') {
              return {
                ...order,
                mechanicId: target.id,
              }
            }

            if (target?.kind === 'bay') {
              return {
                ...order,
                bayId: target.id,
              }
            }

            return viewMode === 'mechanic'
              ? { ...order, mechanicId: null }
              : { ...order, bayId: null }
          }),
        }
      })

      const payload =
        target?.kind === 'mechanic'
          ? { orderId, mechanicId: target.id }
          : target?.kind === 'bay'
            ? { orderId, bayId: target.id }
            : viewMode === 'mechanic'
              ? { orderId, mechanicId: null }
              : { orderId, bayId: null }

      assignBoard.mutate(payload, {
        onError: () => {
          queryClient.setQueryData(workshopKeys.boardActive(), previousData)
          toast.error('Failed to assign order. Please try again.')
        },
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: workshopKeys.boardActive() })
        },
      })
    },
    [assignBoard, queryClient, viewMode],
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const orderId = String(active.id)
    const targetColumnId = String(over.id)
    if (targetColumnId === '__unassigned__') {
      performBoardAssign(orderId, null)
      return
    }

    performBoardAssign(orderId, {
      kind: viewMode === 'mechanic' ? 'mechanic' : 'bay',
      id: targetColumnId,
      label: targetColumnId,
    })
  }

  const isLoading = resourcesLoading || boardLoading

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workshop Board</h1>
          <p className="text-slate-500">Drag &amp; drop orders to assign mechanics and bays.</p>
        </div>
        <BoardViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {/* Board canvas */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
          Loading board…
        </div>
      ) : (
        <>
          {resources.length === 0 && <EmptyResourcesCard mode={viewMode} />}

          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <HorizontalScrollArea contentClassName="gap-4">
              {columns.map((col) => (
                <DroppableColumn
                  key={col.id}
                  id={col.id}
                  label={col.label}
                  orders={col.orders}
                  activeId={activeId}
                  quickAssignTargets={quickAssignTargets}
                  onQuickAssign={performBoardAssign}
                />
              ))}
            </HorizontalScrollArea>

            <DragOverlay>
              {activeOrder && (
                <WorkshopOrderCard order={activeOrder} isDragging />
              )}
            </DragOverlay>
          </DndContext>
        </>
      )}
    </div>
  )
}
