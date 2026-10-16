import { useRef } from 'react'
import { toast } from 'sonner'
import { useSubmitMechanicFinding as useSubmitMechanicFindingMutation } from '@/api/mechanic'
import { generateId } from '@/lib/id'

type UseSubmitMechanicFindingOptions = {
  taskId: string
  mediaIds: string[]
  disabled: boolean
  hasNotes: boolean
  flushAndSaveNotes: () => Promise<void>
}

export function useSubmitMechanicFinding({
  taskId,
  mediaIds,
  disabled,
  hasNotes,
  flushAndSaveNotes,
}: UseSubmitMechanicFindingOptions) {
  const mutation = useSubmitMechanicFindingMutation()
  const commandIdRef = useRef<string | null>(null)

  const canSubmit = !disabled && hasNotes && !mutation.isPending

  const submit = async () => {
    if (!canSubmit) return
    await flushAndSaveNotes()
    if (!commandIdRef.current) {
      commandIdRef.current = generateId()
    }
    const commandId = commandIdRef.current
    try {
      await mutation.mutateAsync({
        taskId,
        payload: {
          command_id: commandId,
          media_ids: mediaIds.length > 0 ? mediaIds : undefined,
        },
      })
      commandIdRef.current = null
      toast.success('Finding sent to the service advisor')
    } catch {
      // Keep commandIdRef for a safe retry with the same idempotency key.
    }
  }

  return {
    submitFinding: submit,
    submitFindingPending: mutation.isPending,
    canSubmitFinding: canSubmit,
    submitFindingError: mutation.error,
  }
}
