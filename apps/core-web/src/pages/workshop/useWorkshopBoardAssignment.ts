import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import {
  type AssignBoardPayload,
  type BoardAssignmentTarget,
  useAssignBoard,
} from '@/api/workshop'

export function useWorkshopBoardAssignment(viewMode: BoardViewMode) {
  const { t } = useTranslation('workshop')
  const { mutateAsync } = useAssignBoard()

  return React.useCallback(
    (orderId: string, target: BoardAssignmentTarget | null) => {
      const payload: AssignBoardPayload =
        target?.kind === 'mechanic'
          ? { orderId, mechanicId: target.id }
          : target?.kind === 'bay'
            ? { orderId, bayId: target.id }
            : viewMode === 'mechanic'
              ? { orderId, mechanicId: null }
              : { orderId, bayId: null }

      // The board update and rollback live in useAssignBoard. mutateAsync (not mutate's callbacks) so a
      // quick second drag does not swallow the error toast of the first.
      mutateAsync(payload).catch(() => toast.error(t('board.assignError')))
    },
    [mutateAsync, t, viewMode],
  )
}
