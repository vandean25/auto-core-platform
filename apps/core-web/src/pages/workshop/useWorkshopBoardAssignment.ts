import * as React from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'
import {
  type BoardActiveResponse,
  type BoardAssignmentTarget,
  useAssignBoard,
  workshopKeys,
} from '@/api/workshop'

export function useWorkshopBoardAssignment(viewMode: BoardViewMode) {
  const queryClient = useQueryClient()
  const assignBoard = useAssignBoard()

  return React.useCallback(
    (orderId: string, target: BoardAssignmentTarget | null) => {
      const previousData = queryClient.getQueryData<BoardActiveResponse>(workshopKeys.boardActive())

      queryClient.setQueryData<BoardActiveResponse>(workshopKeys.boardActive(), (old) => {
        if (!old) return old

        return {
          ...old,
          data: old.data.map((order) => {
            if (order.id !== orderId) return order

            if (target?.kind === 'mechanic') {
              return { ...order, mechanicId: target.id }
            }
            if (target?.kind === 'bay') {
              return { ...order, bayId: target.id }
            }
            return viewMode === 'mechanic'
              ? { ...order, mechanicId: null }
              : { ...order, bayId: null }
          }),
        }
      })

      const payload =
        target?.kind === 'mechanic'
          ? { orderId, mechanicId: target.id }
          : target?.kind === 'bay'
            ? { orderId, bayId: target.id }
            : viewMode === 'mechanic'
              ? { orderId, mechanicId: null }
              : { orderId, bayId: null }

      assignBoard.mutate(payload, {
        onError: () => {
          queryClient.setQueryData(workshopKeys.boardActive(), previousData)
          toast.error('Failed to assign order. Please try again.')
        },
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: workshopKeys.boardActive() })
        },
      })
    },
    [assignBoard, queryClient, viewMode],
  )
}
