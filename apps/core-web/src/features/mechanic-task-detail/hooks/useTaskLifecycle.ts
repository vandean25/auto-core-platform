import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompleteTask, usePauseTask, useStartTask, useSwitchTask } from '@/api/mechanic'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'
import { i18n } from '@/lib/i18n'
import type { PauseReason, SwitchReason } from '../types'

export type UseTaskLifecycleOptions = {
  taskId: string
  refetch: () => Promise<unknown>
  cancelPendingSave: () => void
  /** Called once the server has confirmed the completion (the unsynced notes draft is of no use anymore). */
  onCompleted?: () => void
}

export interface ExecuteTaskStartParams {
  taskId: string
  startTask: ReturnType<typeof useStartTask>
}

export async function executeTaskStart({ taskId, startTask }: ExecuteTaskStartParams): Promise<void> {
  try {
    await startTask.mutateAsync({ taskId })
    toast.success(i18n.t('mechanic.taskDetail.lifecycle.toast.taskStarted', { ns: 'workshop' }))
  } catch (error: unknown) {
    toast.error(
      getErrorMessage(
        error,
        i18n.t('mechanic.taskDetail.lifecycle.toast.taskStartFailed', { ns: 'workshop' }),
      ),
    )
  }
}

export interface ExecuteTaskPauseParams {
  taskId: string
  reason: PauseReason
  pauseTask: ReturnType<typeof usePauseTask>
  cancelPendingSave: () => void
  onSuccess: () => void
}

export async function executeTaskPause({
  taskId,
  reason,
  pauseTask,
  cancelPendingSave,
  onSuccess,
}: ExecuteTaskPauseParams): Promise<void> {
  cancelPendingSave()
  try {
    await pauseTask.mutateAsync({
      taskId,
      payload: { pauseReason: reason },
    })
    toast.success(i18n.t('mechanic.taskDetail.lifecycle.toast.taskPaused', { ns: 'workshop' }))
    onSuccess()
  } catch (error: unknown) {
    toast.error(
      getErrorMessage(
        error,
        i18n.t('mechanic.taskDetail.lifecycle.toast.taskPauseFailed', { ns: 'workshop' }),
      ),
    )
    onSuccess()
  }
}

export interface ExecuteTaskCompleteParams {
  taskId: string
  completeTask: ReturnType<typeof useCompleteTask>
  cancelPendingSave: () => void
  onSuccess: () => void
}

export async function executeTaskComplete({
  taskId,
  completeTask,
  cancelPendingSave,
  onSuccess,
}: ExecuteTaskCompleteParams): Promise<void> {
  cancelPendingSave()
  try {
    await completeTask.mutateAsync({ taskId })
    toast.success(i18n.t('mechanic.taskDetail.lifecycle.toast.taskCompleted', { ns: 'workshop' }))
    onSuccess()
  } catch (error: unknown) {
    toast.error(
      getErrorMessage(
        error,
        i18n.t('mechanic.taskDetail.lifecycle.toast.taskCompleteFailed', { ns: 'workshop' }),
      ),
    )
  }
}

interface RetrySwitchAsStartParams {
  taskId: string
  startTask: ReturnType<typeof useStartTask>
  refetch: () => Promise<unknown>
  setSwitchRetrying: (retrying: boolean) => void
  onSuccess: () => void
}

async function retrySwitchAsStart({
  taskId,
  startTask,
  refetch,
  setSwitchRetrying,
  onSuccess,
}: RetrySwitchAsStartParams): Promise<void> {
  setSwitchRetrying(true)
  try {
    await refetch()
    await startTask.mutateAsync({ taskId })
    toast.success(i18n.t('mechanic.taskDetail.lifecycle.toast.taskStarted', { ns: 'workshop' }))
    onSuccess()
  } catch (startError: unknown) {
    if (getErrorStatus(startError) === 409) {
      toast.error(
        i18n.t('mechanic.taskDetail.lifecycle.toast.taskAlreadyInProgress', { ns: 'workshop' }),
      )
      return
    }
    toast.error(
      getErrorMessage(
        startError,
        i18n.t('mechanic.taskDetail.lifecycle.toast.taskStartFailed', { ns: 'workshop' }),
      ),
    )
  } finally {
    setSwitchRetrying(false)
  }
}

export interface ExecuteTaskSwitchParams {
  taskId: string
  reason: SwitchReason
  switchTask: ReturnType<typeof useSwitchTask>
  startTask: ReturnType<typeof useStartTask>
  refetch: () => Promise<unknown>
  cancelPendingSave: () => void
  setSwitchRetrying: (retrying: boolean) => void
  onSuccess: () => void
}

export async function executeTaskSwitch({
  taskId,
  reason,
  switchTask,
  startTask,
  refetch,
  cancelPendingSave,
  setSwitchRetrying,
  onSuccess,
}: ExecuteTaskSwitchParams): Promise<void> {
  cancelPendingSave()
  setSwitchRetrying(false)

  try {
    await switchTask.mutateAsync({
      taskId,
      payload: { previousPauseReason: reason },
    })
    toast.success(i18n.t('mechanic.taskDetail.lifecycle.toast.taskSwitched', { ns: 'workshop' }))
    onSuccess()
  } catch (error: unknown) {
    if (getErrorStatus(error) === 409) {
      await retrySwitchAsStart({
        taskId,
        startTask,
        refetch,
        setSwitchRetrying,
        onSuccess,
      })
      return
    }

    toast.error(
      getErrorMessage(
        error,
        i18n.t('mechanic.taskDetail.lifecycle.toast.taskSwitchFailed', { ns: 'workshop' }),
      ),
    )
  }
}

export function useTaskLifecycle({ taskId, refetch, cancelPendingSave, onCompleted }: UseTaskLifecycleOptions) {
  const navigate = useNavigate()
  const startTask = useStartTask()
  const switchTask = useSwitchTask()
  const pauseTask = usePauseTask()
  const completeTask = useCompleteTask()

  const [pauseDialogOpen, setPauseDialogOpen] = useState(false)
  const [selectedPauseReason, setSelectedPauseReason] = useState<PauseReason>('WAITING_PARTS')
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false)
  const [selectedSwitchReason, setSelectedSwitchReason] =
    useState<SwitchReason>('SWITCHED_TO_HIGHER_PRIORITY')
  const [switchRetrying, setSwitchRetrying] = useState(false)

  const handleStart = async () => {
    await executeTaskStart({ taskId, startTask })
  }

  const handleSwitchConfirm = async () => {
    await executeTaskSwitch({
      taskId,
      reason: selectedSwitchReason,
      switchTask,
      startTask,
      refetch,
      cancelPendingSave,
      setSwitchRetrying,
      onSuccess: () => setSwitchDialogOpen(false),
    })
  }

  const handlePauseConfirm = async () => {
    await executeTaskPause({
      taskId,
      reason: selectedPauseReason,
      pauseTask,
      cancelPendingSave,
      onSuccess: () => setPauseDialogOpen(false),
    })
  }

  const handleComplete = async () => {
    await executeTaskComplete({
      taskId,
      completeTask,
      cancelPendingSave,
      onSuccess: () => {
        onCompleted?.()
        navigate('/mechanic/queue')
      },
    })
  }

  return {
    startTask,
    switchTask,
    pauseTask,
    completeTask,
    pauseDialogOpen,
    setPauseDialogOpen,
    selectedPauseReason,
    setSelectedPauseReason,
    switchDialogOpen,
    setSwitchDialogOpen,
    selectedSwitchReason,
    setSelectedSwitchReason,
    switchRetrying,
    setSwitchRetrying,
    handleStart,
    handleSwitchConfirm,
    handlePauseConfirm,
    handleComplete,
  }
}
