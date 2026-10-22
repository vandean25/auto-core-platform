import type { MechanicQueueItem } from '@/api/mechanic'
import { getErrorStatus } from '@/lib/error-utils'

export function filterMechanicQueue(items: MechanicQueueItem[], search: string): MechanicQueueItem[] {
  const needle = search.trim().toLowerCase()
  if (!needle) return items

  return items.filter((item) => {
    const vehicle = `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}`
    return [item.taskTitle, item.orderNumber, item.vehicle.plate ?? '', vehicle].some((field) =>
      field.toLowerCase().includes(needle),
    )
  })
}

export type MechanicQueueView =
  | 'loading'
  | 'identity-error'
  | 'load-error'
  | 'no-results'
  | 'empty'
  | 'list'

type MechanicQueueViewInput = {
  isLoading: boolean
  queueError: unknown | null
  itemCount: number
  hasSearch: boolean
}

export function getMechanicQueueView({
  isLoading,
  queueError,
  itemCount,
  hasSearch,
}: MechanicQueueViewInput): MechanicQueueView {
  if (isLoading) return 'loading'
  const queueErrorStatus = queueError ? getErrorStatus(queueError) : null
  if (queueErrorStatus === 404) return 'identity-error'
  if (queueError !== null) return 'load-error'
  if (itemCount === 0 && hasSearch) return 'no-results'
  if (itemCount === 0) return 'empty'
  return 'list'
}
