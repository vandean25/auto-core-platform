import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

import { useUndoWorkshopOrderNotes, workshopKeys } from '@/api/workshop'
import { getErrorMessage } from '@/lib/error-utils'
import {
  clearUndoEligibleEntry,
  getUndoEligibleEntry,
  runUndoInFlight,
} from '@/features/interaction/undo-eligible-entry-store'

export function useRunWorkshopOrderNotesUndo() {
  const { t } = useTranslation('workshop')
  const undoMutation = useUndoWorkshopOrderNotes()
  const queryClient = useQueryClient()

  return useCallback(
    async (orderId: string) => {
      const entry = getUndoEligibleEntry()
      if (!entry || entry.orderId !== orderId) {
        return
      }

      try {
        await runUndoInFlight(async () => {
          const restored = await undoMutation.mutateAsync({
            id: orderId,
            previousNotes: entry.previousNotes,
            expectedUpdatedAt: entry.expectedUpdatedAt,
          })
          clearUndoEligibleEntry()
          queryClient.setQueryData(workshopKeys.order(orderId), restored)
          toast.success(t('orderDetail.toast.notesUndoSuccess'))
        })
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t('orderDetail.toast.notesUndoFailed')))
      }
    },
    [queryClient, t, undoMutation],
  )
}
