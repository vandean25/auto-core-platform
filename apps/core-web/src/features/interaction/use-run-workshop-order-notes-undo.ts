import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

import { useUndoWorkshopOrderNotes, workshopKeys } from '@/api/workshop'
import { getErrorMessage, getHttpErrorStatus } from '@/lib/error-utils'
import {
  clearUndoEligibleEntry,
  getUndoEligibleEntry,
  isUndoInFlight,
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

      if (isUndoInFlight()) {
        return
      }

      try {
        const restored = await runUndoInFlight(async () =>
          undoMutation.mutateAsync({
            id: orderId,
            previousNotes: entry.previousNotes,
            expectedUpdatedAt: entry.expectedUpdatedAt,
          }),
        )
        if (!restored) {
          return
        }
        clearUndoEligibleEntry()
        queryClient.setQueryData(workshopKeys.order(orderId), restored)
        toast.success(t('orderDetail.toast.notesUndoSuccess'))
      } catch (error: unknown) {
        const status = getHttpErrorStatus(error)
        if (status === 403 || status === 409) {
          clearUndoEligibleEntry()
        }
        toast.error(getErrorMessage(error, t('orderDetail.toast.notesUndoFailed')))
      }
    },
    [queryClient, t, undoMutation],
  )
}
