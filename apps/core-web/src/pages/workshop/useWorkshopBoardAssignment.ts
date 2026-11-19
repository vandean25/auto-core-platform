import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import {
  type AssignBoardPayload,
  type BoardAssignmentTarget,
  useAssignBoard,
} from '@/api/workshop'
import { getPermissionAwareErrorMessage } from '@/lib/error-utils'
import { WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID } from './workshop-board-announcements'

/** Order id → id of the column it is moving to. The move is server-confirmed, so these stay where they are until the server answers. */
export type PendingBoardMoves = ReadonlyMap<string, string>

function buildBoardAssignPayload(
  orderId: string,
  target: BoardAssignmentTarget | null,
  viewMode: BoardViewMode,
): AssignBoardPayload {
  if (target?.kind === 'mechanic') return { orderId, mechanicId: target.id }
  if (target?.kind === 'bay') return { orderId, bayId: target.id }
  return viewMode === 'mechanic' ? { orderId, mechanicId: null } : { orderId, bayId: null }
}

function getBoardAssignSuccessKey(target: BoardAssignmentTarget | null, viewMode: BoardViewMode) {
  if (target?.kind === 'mechanic') return 'orderDetail.toast.technicianAssigned' as const
  if (target?.kind === 'bay') return 'board.bayAssigned' as const
  return viewMode === 'mechanic'
    ? ('orderDetail.toast.technicianUnassigned' as const)
    : ('board.bayUnassigned' as const)
}

export function useWorkshopBoardAssignment(viewMode: BoardViewMode) {
  const { t } = useTranslation('workshop')
  const { mutateAsync } = useAssignBoard()
  const [pendingMoves, setPendingMoves] = React.useState<PendingBoardMoves>(new Map())
  const inFlight = React.useRef(new Set<string>())

  const assign = React.useCallback(
    (orderId: string, target: BoardAssignmentTarget | null) => {
      // One move per card at a time: the second drop would be validated against a board the first has not changed yet.
      if (inFlight.current.has(orderId)) return
      const payload = buildBoardAssignPayload(orderId, target, viewMode)
      const successMessage = t(getBoardAssignSuccessKey(target, viewMode))

      inFlight.current.add(orderId)
      setPendingMoves((previous) =>
        new Map(previous).set(orderId, target?.id ?? WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID),
      )
      mutateAsync(payload)
        .then(() => {
          toast.success(successMessage)
        })
        .catch((error: unknown) => toast.error(getPermissionAwareErrorMessage(error, t('board.assignError'))))
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
