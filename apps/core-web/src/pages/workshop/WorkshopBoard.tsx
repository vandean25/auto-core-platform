import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { HorizontalScrollArea } from '@/components/ui/horizontal-scroll-area'
import { WorkshopOrderCardOverlay } from '@/components/workshop/WorkshopOrderCard'
import { BoardViewToggle } from '@/components/workshop/BoardViewToggle'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import { useBoardActive, useWorkshopResources } from '@/api/workshop'
import { createWorkshopBoardAnnouncements } from './workshop-board-announcements'
import { WorkshopBoardColumn } from './WorkshopBoardColumn'
import { WorkshopBoardEmptyResources } from './WorkshopBoardEmptyResources'
import { createWorkshopBoardDragHandlers } from './workshop-board-drag-handlers'
import { buildQuickAssignTargets, buildWorkshopBoardColumns } from './workshop-board-model'
import {
  readWorkshopBoardViewMode,
  WORKSHOP_BOARD_VIEW_MODE_KEY,
} from './workshop-board-view-mode'
import { useWorkshopBoardAssignment } from './useWorkshopBoardAssignment'

export default function WorkshopBoard() {
  const { t } = useTranslation('workshop')
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
  const performBoardAssign = useWorkshopBoardAssignment(viewMode)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  )

  const quickAssignTargets = React.useMemo(
    () => buildQuickAssignTargets(resourcesData),
    [resourcesData],
  )

  const resources = React.useMemo(
    () =>
      viewMode === 'mechanic'
        ? (resourcesData?.mechanics ?? [])
        : (resourcesData?.bays ?? []),
    [resourcesData, viewMode],
  )

  const orders = React.useMemo(() => boardData?.data ?? [], [boardData])

  const columns = React.useMemo(
    () => buildWorkshopBoardColumns(viewMode, resources, orders, t('board.unassigned')),
    [resources, orders, viewMode, t],
  )

  const accessibility = React.useMemo(
    () => ({ announcements: createWorkshopBoardAnnouncements(orders, columns, viewMode, t) }),
    [orders, columns, viewMode, t],
  )

  const activeOrder = activeId ? orders.find((order) => order.id === activeId) ?? null : null

  const dragHandlers = React.useMemo(
    () => createWorkshopBoardDragHandlers(viewMode, setActiveId, performBoardAssign),
    [viewMode, performBoardAssign],
  )

  const isLoading = resourcesLoading || boardLoading

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t('board.title')}</h1>
          <p className="text-slate-500">{t('board.description')}</p>
        </div>
        <BoardViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
          {t('board.loading')}
        </div>
      ) : (
        <>
          {resources.length === 0 && <WorkshopBoardEmptyResources mode={viewMode} />}

          <DndContext
            sensors={sensors}
            accessibility={accessibility}
            onDragStart={dragHandlers.onDragStart}
            onDragEnd={dragHandlers.onDragEnd}
          >
            <HorizontalScrollArea
              layout="workshop-board"
              contentClassName="gap-4"
              ariaLabel={t('board.columnsAriaLabel')}
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
