import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import { CheckSquare, ExternalLink, FileDown, LogIn, User } from 'lucide-react'

import {
  downloadWorkshopPdf,
  type useGenerateWorkshopPdf,
} from '@/api/workshop'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { triggerBlobDownload } from '@/lib/download'
import { toast } from 'sonner'
import type { WorkshopOrder, WorkshopTask, WorkshopTaskStatus } from '@/api/types'
import { getErrorMessage } from '@/pages/workshop/utils/error'
import {
  canAssignWorkshopOrderMechanic,
  canCheckInWorkshopOrder,
  canGenerateWorkshopJobCardPdf,
  canOpenWorkshopOrder,
  canUpdateWorkshopOrderTaskState,
  isWorkshopCheckInOpenStatus,
  isWorkshopOrderLockedStatus,
  isWorkshopTechAssignableStatus,
} from './action-role-predicates'
import {
  ENTITY_ACTION_IDS,
  type EntityActionChild,
  type EntityActionDefinition,
} from './entity-action'

export type WorkshopMechanicOption = {
  id: string
  name: string
}

export type WorkshopOrderListRow = {
  id: string
  orderNo: string
  customer: string
  vehicle: string
  openedAt: string
  status: WorkshopOrder['status']
  mechanicId?: string | null
  tasks?: WorkshopTask[]
}

export type WorkshopOrderRowActionContext = {
  navigate: NavigateFunction
  generatePdf: ReturnType<typeof useGenerateWorkshopPdf>
  t: TFunction<'workshop'>
  mechanics?: WorkshopMechanicOption[]
  assignMechanic?: (
    orderId: string,
    mechanicId: string | null,
    currentMechanicId: string | null,
  ) => void | Promise<void>
  updateTaskStatus?: (
    orderId: string,
    taskId: string,
    status: WorkshopTaskStatus,
  ) => void | Promise<void>
}

function workshopOrderDetailPath(orderId: string) {
  return APP_ROUTE_PATHS.workshopOrderDetail.replace(':id', orderId)
}

function workshopOrderCheckInPath(orderId: string) {
  return APP_ROUTE_PATHS.workshopOrderCheckIn.replace(':id', orderId)
}

function sanitizeActionIdSegment(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '')
  return cleaned.length > 0 ? cleaned : 'item'
}

export async function runAssignWorkshopOrderMechanic(
  orderId: string,
  mechanicId: string | null,
  currentMechanicId: string | null | undefined,
  mutateAssign: (payload: { orderId: string; mechanicId: string | null }) => Promise<unknown>,
  t: TFunction<'workshop'>,
) {
  if (mechanicId === (currentMechanicId ?? null)) return
  try {
    await mutateAssign({ orderId, mechanicId })
    toast.success(
      mechanicId
        ? t('orderDetail.toast.technicianAssigned')
        : t('orderDetail.toast.technicianUnassigned'),
    )
  } catch (error: unknown) {
    toast.error(getErrorMessage(error, t('orderDetail.toast.technicianAssignFailed')))
  }
}

export async function runUpdateWorkshopOrderTaskStatus(
  orderId: string,
  taskId: string,
  status: WorkshopTaskStatus,
  mutateTask: (payload: {
    orderId: string
    taskId: string
    status: WorkshopTaskStatus
  }) => Promise<unknown>,
  t: TFunction<'workshop'>,
) {
  try {
    await mutateTask({ orderId, taskId, status })
  } catch (error: unknown) {
    toast.error(getErrorMessage(error, t('orderDetail.toast.taskStatusUpdateFailed')))
  }
}

function buildAssignMechanicChildren(
  row: WorkshopOrderListRow,
  context: WorkshopOrderRowActionContext,
  t: TFunction<'workshop'>,
): EntityActionChild<WorkshopOrderListRow, WorkshopOrderRowActionContext>[] {
  const mechanics = context.mechanics ?? []
  if (!context.assignMechanic || mechanics.length === 0) return []

  const items: EntityActionChild<WorkshopOrderListRow, WorkshopOrderRowActionContext>[] = [
    ...mechanics.map((mechanic) => ({
      id: `${ENTITY_ACTION_IDS.workOrderAssignMechanic}.${sanitizeActionIdSegment(mechanic.id)}`,
      label: mechanic.name,
      icon: User,
      isEnabled: (record: WorkshopOrderListRow) =>
        isWorkshopTechAssignableStatus(record.status) && record.mechanicId !== mechanic.id,
      run: async (record: WorkshopOrderListRow, ctx: WorkshopOrderRowActionContext) => {
        await ctx.assignMechanic?.(record.id, mechanic.id, record.mechanicId ?? null)
      },
    })),
  ]

  if (row.mechanicId) {
    items.push({
      id: `${ENTITY_ACTION_IDS.workOrderAssignMechanic}.unassigned`,
      label: t('orderHeader.unassigned'),
      icon: User,
      isEnabled: (record: WorkshopOrderListRow) =>
        isWorkshopTechAssignableStatus(record.status) && Boolean(record.mechanicId),
      run: async (record: WorkshopOrderListRow, ctx: WorkshopOrderRowActionContext) => {
        await ctx.assignMechanic?.(record.id, null, record.mechanicId ?? null)
      },
    })
  }

  return items
}

function buildTaskStateLeafItems(
  task: WorkshopTask,
  taskSegment: string,
  t: TFunction<'workshop'>,
): EntityActionChild<WorkshopOrderListRow, WorkshopOrderRowActionContext>[] {
  const baseId = `${ENTITY_ACTION_IDS.workOrderTaskState}.${taskSegment}`
  const isDone = task.status === 'DONE' || task.done

  return [
    {
      id: `${baseId}.done`,
      label: t('orders.list.actions.taskDone'),
      icon: CheckSquare,
      isEnabled: (record) => !isWorkshopOrderLockedStatus(record.status) && !isDone,
      run: async (record, ctx) => {
        await ctx.updateTaskStatus?.(record.id, task.id, 'DONE')
      },
    },
    {
      id: `${baseId}.reopen`,
      label: t('orders.list.actions.taskReopen'),
      icon: CheckSquare,
      isEnabled: (record) => !isWorkshopOrderLockedStatus(record.status) && isDone,
      run: async (record, ctx) => {
        await ctx.updateTaskStatus?.(record.id, task.id, 'IN_PROGRESS')
      },
    },
  ]
}

function buildTaskStateChildren(
  row: WorkshopOrderListRow,
  context: WorkshopOrderRowActionContext,
  t: TFunction<'workshop'>,
): EntityActionChild<WorkshopOrderListRow, WorkshopOrderRowActionContext>[] {
  const tasks = row.tasks ?? []
  if (!context.updateTaskStatus || tasks.length === 0) return []

  return tasks.map((task) => {
    const taskSegment = sanitizeActionIdSegment(task.id)
    return {
      id: `${ENTITY_ACTION_IDS.workOrderTaskState}.${taskSegment}`,
      label: task.title,
      icon: CheckSquare,
      isEnabled: (record) => !isWorkshopOrderLockedStatus(record.status),
      children: buildTaskStateLeafItems(task, taskSegment, t),
    }
  })
}

export async function runGenerateWorkshopJobCardPdf(
  row: Pick<WorkshopOrderListRow, 'id' | 'orderNo'>,
  { generatePdf, t: translate }: Pick<WorkshopOrderRowActionContext, 'generatePdf' | 't'>,
) {
  const toastId = toast.loading(translate('orderDetail.toast.jobCardPdfGenerating'))
  try {
    const res = await generatePdf.mutateAsync(row.id)
    if (res.enqueued) {
      toast.success(translate('orderDetail.toast.jobCardPdfQueued'), { id: toastId })
      return
    }
    const blob = await downloadWorkshopPdf(row.id)
    const fileName = `job-card-${row.orderNo}`
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()
    triggerBlobDownload(blob, `${fileName}.pdf`)
    toast.success(translate('orderDetail.toast.jobCardPdfDownloaded'), { id: toastId })
  } catch (error: unknown) {
    toast.error(getErrorMessage(error, translate('orderDetail.toast.jobCardPdfFailed')), {
      id: toastId,
    })
  }
}

export function createWorkshopOrderJobCardPdfAction(
  t: TFunction<'workshop'>,
): EntityActionDefinition<WorkshopOrderListRow, WorkshopOrderRowActionContext> {
  return {
    id: ENTITY_ACTION_IDS.workOrderJobCardPdf,
    kind: 'run',
    label: t('orders.list.actions.jobCardPdf'),
    icon: FileDown,
    isAllowedForRole: canGenerateWorkshopJobCardPdf,
    isEnabled: () => true,
    run: runGenerateWorkshopJobCardPdf,
  }
}

export function createWorkshopOrderRowActions(
  t: TFunction<'workshop'>,
): EntityActionDefinition<WorkshopOrderListRow, WorkshopOrderRowActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.workOrderOpen,
      kind: 'navigate',
      label: t('orders.list.actions.open'),
      icon: ExternalLink,
      shortcutKey: 'o',
      isAllowedForRole: canOpenWorkshopOrder,
      isEnabled: () => true,
      run: (row, { navigate }) => {
        navigate(workshopOrderDetailPath(row.id))
      },
    },
    {
      id: ENTITY_ACTION_IDS.workOrderCheckIn,
      kind: 'navigate',
      label: t('orders.list.actions.checkIn'),
      icon: LogIn,
      isAllowedForRole: canCheckInWorkshopOrder,
      isEnabled: (row) => isWorkshopCheckInOpenStatus(row.status),
      run: (row, { navigate }) => {
        navigate(workshopOrderCheckInPath(row.id))
      },
    },
    createWorkshopOrderJobCardPdfAction(t),
    {
      id: ENTITY_ACTION_IDS.workOrderAssignMechanic,
      kind: 'run',
      label: t('orders.list.actions.assignMechanic'),
      icon: User,
      isAllowedForRole: canAssignWorkshopOrderMechanic,
      isEnabled: (row) => isWorkshopTechAssignableStatus(row.status),
      children: (row, context) => buildAssignMechanicChildren(row, context, t),
      run: () => {},
    },
    {
      id: ENTITY_ACTION_IDS.workOrderTaskState,
      kind: 'run',
      label: t('orders.list.actions.taskState'),
      icon: CheckSquare,
      isAllowedForRole: canUpdateWorkshopOrderTaskState,
      isEnabled: (row) => !isWorkshopOrderLockedStatus(row.status) && (row.tasks?.length ?? 0) > 0,
      children: (row, context) => buildTaskStateChildren(row, context, t),
      run: () => {},
    },
  ]
}
