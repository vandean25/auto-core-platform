import * as React from 'react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import { useUpdateWorkshopOrder } from '@/api/workshop'
import { getPermissionAwareErrorMessage } from '@/lib/error-utils'

export function usePlannerPendingReschedule(t: TFunction<'workshop'>) {
  const updateOrder = useUpdateWorkshopOrder()
  const [pendingMoves, setPendingMoves] = React.useState<ReadonlySet<string>>(new Set())

  const performReschedule = React.useCallback(
    (orderId: string, bayId: string, startIso: string, durationMs: number) => {
      if (pendingMoves.has(orderId)) return
      const start = new Date(startIso)
      const end = new Date(start.getTime() + durationMs)
      setPendingMoves((previous) => new Set(previous).add(orderId))

      // mutateAsync, not mutate's callbacks: those only fire for the latest call of a hook instance.
      updateOrder
        .mutateAsync({
          id: orderId,
          bayId,
          scheduledStartAt: start.toISOString(),
          scheduledEndAt: end.toISOString(),
        })
        .catch((error: unknown) => {
          toast.error(getPermissionAwareErrorMessage(error, t('planner.page.rescheduleFailed')))
        })
        .finally(() => {
          setPendingMoves((previous) => {
            const next = new Set(previous)
            next.delete(orderId)
            return next
          })
        })
    },
    [pendingMoves, t, updateOrder],
  )

  return { pendingMoves, performReschedule }
}
