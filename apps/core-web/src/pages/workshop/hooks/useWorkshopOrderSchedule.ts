import { useTranslation } from 'react-i18next'
import { useUpdateWorkshopOrder } from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import { runRescheduleWorkshopOrder } from '@/features/actions/work-order-row-actions'
import { DEFAULT_TIME_ZONE } from '@/lib/i18n/constants'
import { formatLocalDateInZone } from '@/lib/format'
import { canRescheduleWorkshopOrder, workshopScheduleDateOptions } from '../workshop-schedule-date'

function instant(value: string | null | undefined) {
  return value ?? null
}

/** Server-confirmed date change: the planner validates bay and mechanic availability. */
export function useWorkshopOrderSchedule(order: WorkshopOrder) {
  const { t } = useTranslation('workshop')
  const updateOrder = useUpdateWorkshopOrder()
  const start = instant(order.scheduledStartAt ?? order.scheduled_start_at)
  const end = instant(order.scheduledEndAt ?? order.scheduled_end_at)
  const bayId = order.bayId ?? order.bay_id ?? null
  const canEdit = canRescheduleWorkshopOrder({
    status: order.status,
    bayId,
    scheduledStartAt: start,
    scheduledEndAt: end,
  })
  const currentDate = start ? formatLocalDateInZone(new Date(start), DEFAULT_TIME_ZONE) : null
  const options = workshopScheduleDateOptions(new Date(), DEFAULT_TIME_ZONE, currentDate)
  const label = options.find((option) => option.value === currentDate)?.label ?? t('orderHeader.notSet')

  const save = async (date: string) => {
    if (!canEdit || !start || !end || !bayId) return
    await runRescheduleWorkshopOrder(
      { orderId: order.id, bayId, startIso: start, endIso: end, date },
      updateOrder.mutateAsync,
      t,
    )
  }

  return {
    label,
    canEdit,
    pending: updateOrder.isPending,
    currentDate,
    options,
    save,
  }
}
