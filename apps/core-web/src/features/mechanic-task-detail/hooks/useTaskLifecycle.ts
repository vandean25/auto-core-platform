import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompleteTask, usePauseTask, useStartTask, useSwitchTask } from '@/api/mechanic'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'
import type { PauseReason, SwitchReason } from '../types'

type UseTaskLifecycleOptions = {
  taskId: string
  refetch: () => Promise<unknown>
  cancelPendingSave: () => void
}

export function useTaskLifecycle({ taskId, refetch, cancelPendingSave }: UseTaskLifecycleOptions) {
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
    try {
      await startTask.mutateAsync({ taskId })
      toast.success('Task started — punch-in recorded')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to start task'))
    }
  }

  const handleSwitchConfirm = async () => {
    cancelPendingSave()
    setSwitchRetrying(false)
    try {
      await switchTask.mutateAsync({
        taskId,
        payload: { previousPauseReason: selectedSwitchReason },
      })
      toast.success('Switched to task — punch-in recorded')
      setSwitchDialogOpen(false)
    } catch (error: unknown) {
      if (getErrorStatus(error) === 409) {
        setSwitchRetrying(true)
        await refetch()
        try {
          await startTask.mutateAsync({ taskId })
          toast.success('Task started — punch-in recorded')
          setSwitchDialogOpen(false)
        } catch (startError: unknown) {
          if (getErrorStatus(startError) === 409) {
            toast.error('This task is already being worked on. Please refresh.')
          } else {
            toast.error(getErrorMessage(startError, 'Failed to start task'))
          }
        } finally {
          setSwitchRetrying(false)
        }
      } else {
        toast.error(getErrorMessage(error, 'Failed to switch task'))
      }
    }
  }

  const handlePauseConfirm = async () => {
    cancelPendingSave()
    try {
      await pauseTask.mutateAsync({
        taskId,
        payload: { pauseReason: selectedPauseReason },
      })
      toast.success('Task paused')
      setPauseDialogOpen(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to pause task'))
    }
  }

  const handleComplete = async () => {
    cancelPendingSave()
    try {
      await completeTask.mutateAsync({ taskId })
      toast.success('Task marked as complete')
      navigate('/mechanic/queue')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to complete task'))
    }
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
