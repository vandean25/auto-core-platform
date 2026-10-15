import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useSubmitMechanicFinding as useSubmitMechanicFindingMutation } from '@/api/mechanic'
import { generateId } from '@/lib/id'

type UseSubmitMechanicFindingOptions = {
  taskId: string
  mediaIds: string[]
  disabled: boolean
  hasNotes: boolean
}

export function useSubmitMechanicFinding({
  taskId,
  mediaIds,
  disabled,
  hasNotes,
}: UseSubmitMechanicFindingOptions) {
  const mutation = useSubmitMechanicFindingMutation()

  const canSubmit = !disabled && hasNotes && !mutation.isPending

  const submit = async () => {
    if (!canSubmit) return
    const commandId = generateId()
    await mutation.mutateAsync({
      taskId,
      payload: {
        command_id: commandId,
        media_ids: mediaIds.length > 0 ? mediaIds : undefined,
      },
    })
    toast.success('Finding sent to the service advisor')
  }

  return {
    submitFinding: submit,
    submitFindingPending: mutation.isPending,
    canSubmitFinding: canSubmit,
    submitFindingError: mutation.error,
  }
}
