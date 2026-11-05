import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { WorkshopTaskStatus } from '@/api/types'
import {
  useAssignBoard,
  useGenerateWorkshopPdf,
  useUpdateWorkshopTask,
  useWorkshopResources,
} from '@/api/workshop'
import {
  runAssignWorkshopOrderMechanic,
  runUpdateWorkshopOrderTaskStatus,
  type WorkshopOrderRowActionContext,
} from './work-order-row-actions'
import { useRunWorkshopOrderNotesUndo } from '@/features/interaction/use-run-workshop-order-notes-undo'

/**
 * Everything the work order registry actions need to run: navigation, the PDF job, the active mechanics and the
 * mechanic/task mutations. The command palette and the peek sheet share it, so both offer the same actions.
 */
export function useWorkOrderActionRunContext(): WorkshopOrderRowActionContext {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const generatePdf = useGenerateWorkshopPdf()
  const assignBoard = useAssignBoard()
  const updateTask = useUpdateWorkshopTask()
  const runNotesUndo = useRunWorkshopOrderNotesUndo()
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

  return useMemo(
    () => ({
      navigate,
      generatePdf,
      t,
      mechanics,
      assignMechanic,
      updateTaskStatus,
      undoNotes: (orderId: string) => runNotesUndo(orderId),
    }),
    [assignMechanic, generatePdf, mechanics, navigate, runNotesUndo, t, updateTaskStatus],
  )
}
