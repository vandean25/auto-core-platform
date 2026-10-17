import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import type { BoardAssignmentTarget, BoardOrder, WorkshopResourcesResponse } from '@/api/workshop'
import { WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID } from './workshop-board-announcements'

export type WorkshopBoardColumnModel = {
  id: string
  label: string
  orders: BoardOrder[]
}

export function buildQuickAssignTargets(
  resourcesData: WorkshopResourcesResponse | undefined,
): BoardAssignmentTarget[] {
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
}

export function buildWorkshopBoardColumns(
  viewMode: BoardViewMode,
  resourceList: Array<{ id: string; name: string }>,
  orders: BoardOrder[],
  unassignedLabel: string,
): WorkshopBoardColumnModel[] {
  const resourceCols = resourceList.map((resource) => ({
    id: resource.id,
    label: resource.name,
    orders: orders.filter((order) =>
      viewMode === 'mechanic' ? order.mechanicId === resource.id : order.bayId === resource.id,
    ),
  }))

  const unassignedOrders = orders.filter((order) =>
    viewMode === 'mechanic' ? !order.mechanicId : !order.bayId,
  )

  return [
    ...resourceCols,
    { id: WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID, label: unassignedLabel, orders: unassignedOrders },
  ]
}
