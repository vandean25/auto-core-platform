import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { WorkshopTaskStatus } from '@/api/types'
import {
  useAssignBoard,
  useGenerateWorkshopPdf,
  useUpdateWorkshopOrder,
  useUpdateWorkshopTask,
  useWorkshopResources,
} from '@/api/workshop'
import {
  runAssignWorkshopOrderMechanic,
  runRescheduleWorkshopOrder,
  runUpdateWorkshopOrderTaskStatus,
  type WorkshopOrderRescheduleRequest,
  type WorkshopOrderRowActionContext,
} from './work-order-row-actions'
import {
  getUndoEligibleEntry,
  runLatestEligibleUndoFromShortcut,
} from '@/features/interaction/undo-eligible-entry-store'

/**
 * Everything the work order registry actions need to run: navigation, the PDF job, the active mechanics and the
 * mechanic/task mutations. The command palette and the peek sheet share it, so both offer the same actions.
 */
export function useWorkOrderActionRunContext(): WorkshopOrderRowActionContext {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const generatePdf = useGenerateWorkshopPdf()
  const assignBoard = useAssignBoard()
  const updateOrder = useUpdateWorkshopOrder()
  const updateTask = useUpdateWorkshopTask()
  const workshopResourcesQuery = useWorkshopResources()

  const mechanics = useMemo(
    () =>
      workshopResourcesQuery?.data?.mechanics
        ?.filter((mechanic) => mechanic.isActive)
        .map((mechanic) => ({ id: mechanic.id, name: mechanic.name })) ?? [],
    [workshopResourcesQuery?.data],
  )

  const assignMechanic = useCallback(
    async (orderId: string, mechanicId: string | null, currentMechanicId: string | null) => {
      await runAssignWorkshopOrderMechanic(orderId, mechanicId, currentMechanicId, assignBoard.mutateAsync, t)
    },
    [assignBoard, t],
  )

  const updateTaskStatus = useCallback(
    async (orderId: string, taskId: string, status: WorkshopTaskStatus) => {
      await runUpdateWorkshopOrderTaskStatus(orderId, taskId, status, updateTask.mutateAsync, t)
    },
    [t, updateTask],
  )

  const reschedule = useCallback(
    async (request: WorkshopOrderRescheduleRequest) => {
      await runRescheduleWorkshopOrder(request, updateOrder.mutateAsync, t)
    },
    [t, updateOrder],
  )

  return useMemo(
    () => ({
      navigate,
      generatePdf,
      t,
      mechanics,
      assignMechanic,
      updateTaskStatus,
      reschedule,
      undoNotes: (orderId: string) => {
        const entry = getUndoEligibleEntry()
        if (entry?.orderId === orderId) {
          runLatestEligibleUndoFromShortcut()
        }
      },
    }),
    [assignMechanic, generatePdf, mechanics, navigate, reschedule, t, updateTaskStatus],
  )
}
