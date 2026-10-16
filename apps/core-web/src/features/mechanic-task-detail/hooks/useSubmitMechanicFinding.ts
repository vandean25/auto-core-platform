import { useRef } from 'react'
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
  const mutation = useSubmitMechanicFindingMutation()
  const commandIdRef = useRef<string | null>(null)

  const canSubmit = !disabled && hasNotes && !mutation.isPending

  const submit = async () => {
    if (!canSubmit) return
    try {
      await flushAndSaveNotes()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save diagnostic notes'))
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
      toast.success('Finding sent to the service advisor')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not send finding to the advisor'))
    }
  }

  return {
    submitFinding: submit,
    submitFindingPending: mutation.isPending,
    canSubmitFinding: canSubmit,
    submitFindingError: mutation.error,
  }
}
