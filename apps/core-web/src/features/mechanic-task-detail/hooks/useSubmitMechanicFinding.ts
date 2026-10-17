import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSubmitMechanicFinding as useSubmitMechanicFindingMutation } from '@/api/mechanic'
import { generateId } from '@/lib/id'
import { getErrorMessage } from '@/lib/error-utils'

type UseSubmitMechanicFindingOptions = {
  taskId: string
  disabled: boolean
  hasNotes: boolean
  flushAndSaveNotes: () => Promise<void>
}

export function useSubmitMechanicFinding({
  taskId,
  disabled,
  hasNotes,
  flushAndSaveNotes,
}: UseSubmitMechanicFindingOptions) {
  const { t } = useTranslation('workshop')
  const mutation = useSubmitMechanicFindingMutation()
  const commandIdRef = useRef<string | null>(null)

  const canSubmit = !disabled && hasNotes && !mutation.isPending

  const submit = async () => {
    if (!canSubmit) return
    try {
      await flushAndSaveNotes()
    } catch (error) {
      toast.error(
        getErrorMessage(error, t('mechanic.taskDetail.finding.toast.notesSaveFailed')),
      )
      return
    }

    if (!commandIdRef.current) {
      commandIdRef.current = generateId()
    }
    const commandId = commandIdRef.current
    try {
      await mutation.mutateAsync({
        taskId,
        payload: {
          command_id: commandId,
        },
      })
      commandIdRef.current = null
      toast.success(t('mechanic.taskDetail.finding.toast.sentToAdvisor'))
    } catch (error) {
      toast.error(
        getErrorMessage(error, t('mechanic.taskDetail.finding.toast.sendFailed')),
      )
    }
  }

  return {
    submitFinding: submit,
    submitFindingPending: mutation.isPending,
    canSubmitFinding: canSubmit,
    submitFindingError: mutation.error,
  }
}
