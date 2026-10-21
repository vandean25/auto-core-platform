import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  useCreateWorkshopTask,
  useDeleteWorkshopTask,
  useUpdateWorkshopTask,
} from '@/api/workshop'
import type { WorkshopOrder, WorkshopTask, WorkshopTaskStatus } from '@/api/types'
import { PICKERL_TASK_TITLE } from '@/features/workshop/pickerl.constants'
import { getErrorMessage } from '../utils/error'

interface UseWorkshopTaskActionsOptions {
  order: WorkshopOrder
  isLocked: boolean
  tasks: WorkshopTask[]
  hasLinkedInvoice: boolean
  expandedTaskId: string | null
  onExpandedTaskIdChange: (taskId: string | null) => void
  clearTaskLineItemOverrides: (taskId: string) => void
  pickerl: { canManagePickerl: boolean; offerRecording: () => void }
}

/** Adding, completing, annotating and deleting the repair tasks of an order. Locked orders ignore every change. */
export function useWorkshopTaskActions({
  order,
  isLocked,
  tasks,
  hasLinkedInvoice,
  expandedTaskId,
  onExpandedTaskIdChange,
  clearTaskLineItemOverrides,
  pickerl,
}: UseWorkshopTaskActionsOptions) {
  const { t } = useTranslation('workshop')
  const createTask = useCreateWorkshopTask()
  const deleteTask = useDeleteWorkshopTask()
  const updateTask = useUpdateWorkshopTask()
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [taskPendingDelete, setTaskPendingDelete] = useState<WorkshopTask | null>(null)

  const canDeleteTasks = !isLocked && !hasLinkedInvoice

  const addTask = async () => {
    if (isLocked) return
    const title = newTaskTitle.trim()
    if (!title) return

    try {
      const created = await createTask.mutateAsync({
        orderId: order.id,
        title,
      })
      setNewTaskTitle('')
      onExpandedTaskIdChange(created.id)
      toast.success(t('orderDetail.toast.taskCreated'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('orderDetail.toast.taskCreateFailed')))
    }
  }

  const changeTaskStatus = async (taskId: string, status: WorkshopTaskStatus) => {
    if (isLocked) return
    try {
      await updateTask.mutateAsync({ orderId: order.id, taskId, status })
      const task = tasks.find((candidate) => candidate.id === taskId)
      if (
        status === 'DONE' &&
        task?.title === PICKERL_TASK_TITLE &&
        pickerl.canManagePickerl
      ) {
        pickerl.offerRecording()
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('orderDetail.toast.taskStatusUpdateFailed')))
    }
  }

  const toggleTask = async (taskId: string, checked: boolean) => {
    await changeTaskStatus(taskId, checked ? 'DONE' : 'IN_PROGRESS')
  }

  const changeMechanicNotes = async (taskId: string, notes: string) => {
    if (isLocked) return
    try {
      await updateTask.mutateAsync({
        orderId: order.id,
        taskId,
        mechanicNotes: notes,
      })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('orderDetail.toast.mechanicNotesUpdateFailed')))
    }
  }

  const requestDeleteTask = (taskId: string) => {
    const task = tasks.find((existingTask) => existingTask.id === taskId)
    if (task) {
      setTaskPendingDelete(task)
    }
  }

  const confirmDeleteTask = async () => {
    if (!taskPendingDelete || !canDeleteTasks) return

    try {
      await deleteTask.mutateAsync({
        orderId: order.id,
        taskId: taskPendingDelete.id,
      })
      if (expandedTaskId === taskPendingDelete.id) {
        onExpandedTaskIdChange(null)
      }
      clearTaskLineItemOverrides(taskPendingDelete.id)
      setTaskPendingDelete(null)
      toast.success(t('orderDetail.toast.taskDeleted'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('orderDetail.toast.taskDeleteFailed')))
    }
  }

  return {
    newTaskTitle,
    setNewTaskTitle,
    canDeleteTasks,
    isDeletingTask: deleteTask.isPending,
    taskPendingDelete,
    cancelDeleteTask: () => setTaskPendingDelete(null),
    addTask,
    toggleTask,
    changeMechanicNotes,
    requestDeleteTask,
    confirmDeleteTask,
  }
}
