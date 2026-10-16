import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { HorizontalScrollArea } from '@/components/ui/horizontal-scroll-area'
import { WorkshopOrderCardOverlay } from '@/components/workshop/WorkshopOrderCard'
import { BoardViewToggle } from '@/components/workshop/BoardViewToggle'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import {
  type BoardActiveResponse,
  type BoardAssignmentTarget,
  useBoardActive,
  useWorkshopResources,
  useAssignBoard,
  workshopKeys,
} from '@/api/workshop'
import { createWorkshopBoardAnnouncements, WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID } from './workshop-board-announcements'
import { WorkshopBoardColumn } from './WorkshopBoardColumn'
import { WorkshopBoardEmptyResources } from './WorkshopBoardEmptyResources'
import {
  readWorkshopBoardViewMode,
  WORKSHOP_BOARD_VIEW_MODE_KEY,
} from './workshop-board-view-mode'

export default function WorkshopBoard() {
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = React.useState<BoardViewMode>(readWorkshopBoardViewMode)
  const [activeId, setActiveId] = React.useState<string | null>(null)

  React.useEffect(() => {
    try {
      window.localStorage.setItem(WORKSHOP_BOARD_VIEW_MODE_KEY, viewMode)
    } catch {
      // ignore
    }
  }, [viewMode])

  const { data: resourcesData, isLoading: resourcesLoading } = useWorkshopResources()
  const { data: boardData, isLoading: boardLoading } = useBoardActive()
  const assignBoard = useAssignBoard()

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  )

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
      { id: WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID, label: 'Unassigned', orders: unassignedOrders },
    ]
  }, [resources, orders, viewMode])

  const accessibility = React.useMemo(
    () => ({ announcements: createWorkshopBoardAnnouncements(orders, columns, viewMode) }),
    [orders, columns, viewMode],
  )

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
    if (targetColumnId === WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID) {
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Workshop Board</h1>
          <p className="text-slate-500">Drag &amp; drop orders to assign mechanics and bays.</p>
        </div>
        <BoardViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
          Loading board…
        </div>
      ) : (
        <>
          {resources.length === 0 && <WorkshopBoardEmptyResources mode={viewMode} />}

          <DndContext
            sensors={sensors}
            accessibility={accessibility}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <HorizontalScrollArea
              layout="workshop-board"
              contentClassName="gap-4"
              ariaLabel="Workshop board columns"
            >
              {columns.map((col) => (
                <WorkshopBoardColumn
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
              {activeOrder ? (
                <div className="w-[min(17rem,100vw-3rem)]">
                  <WorkshopOrderCardOverlay order={activeOrder} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}
    </div>
  )
}
