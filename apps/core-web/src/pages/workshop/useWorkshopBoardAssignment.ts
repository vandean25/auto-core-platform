import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import {
  type AssignBoardPayload,
  type BoardAssignmentTarget,
  useAssignBoard,
} from '@/api/workshop'
import { getErrorMessage } from '@/lib/error-utils'
import { WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID } from './workshop-board-announcements'

/** Order id → id of the column it is moving to. The move is server-confirmed, so these stay where they are until the server answers. */
export type PendingBoardMoves = ReadonlyMap<string, string>

export function useWorkshopBoardAssignment(viewMode: BoardViewMode) {
  const { t } = useTranslation('workshop')
  const { mutateAsync } = useAssignBoard()
  const [pendingMoves, setPendingMoves] = React.useState<PendingBoardMoves>(new Map())
  const inFlight = React.useRef(new Set<string>())

  const assign = React.useCallback(
    (orderId: string, target: BoardAssignmentTarget | null) => {
      // One move per card at a time: the second drop would be validated against a board the first has not changed yet.
      if (inFlight.current.has(orderId)) return
      const payload: AssignBoardPayload =
        target?.kind === 'mechanic'
          ? { orderId, mechanicId: target.id }
          : target?.kind === 'bay'
            ? { orderId, bayId: target.id }
            : viewMode === 'mechanic'
              ? { orderId, mechanicId: null }
              : { orderId, bayId: null }

      inFlight.current.add(orderId)
      setPendingMoves((previous) =>
        new Map(previous).set(orderId, target?.id ?? WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID),
      )
      mutateAsync(payload)
        .catch((error: unknown) => toast.error(getErrorMessage(error, t('board.assignError'))))
        .finally(() => {
          inFlight.current.delete(orderId)
          setPendingMoves((previous) => {
            const next = new Map(previous)
            next.delete(orderId)
            return next
          })
        })
    },
    [mutateAsync, t, viewMode],
  )

  return { assign, pendingMoves }
}
